import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { randomUUID } from 'crypto';
import { getNonce, formatBytes, getWorkspaceFolder, getOrCompileDataformJson } from '../utils';
import { queryDryRun } from '../bigqueryDryRun';
import { queryBigQuery } from '../bigqueryRunQuery';
import { fetchTableMetadata } from '../hoverProvider';
import { DataformCompiledJson, Target, Table, Assertion, Operation } from '../types';

type FilterPreset = {
    id: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    globalFilter: string;
    applyToAll: boolean;
    deps: Record<string, { enabled: boolean; filterCondition: string }>;
};

type FilterFile = { version: 2; filters: Record<string, FilterPreset[]> };

function migrateToV2(parsed: any): FilterFile {
    if (parsed && parsed.version === 2 && parsed.filters && typeof parsed.filters === 'object') {
        return parsed as FilterFile;
    }
    const out: FilterFile = { version: 2, filters: {} };
    const oldFilters = parsed?.filters && typeof parsed.filters === 'object' ? parsed.filters : {};
    const now = new Date().toISOString();
    for (const [modelId, entry] of Object.entries(oldFilters)) {
        if (!entry || typeof entry !== 'object') { continue; }
        const e = entry as any;
        out.filters[modelId] = [{
            id: randomUUID(),
            description: typeof e.description === 'string' ? e.description : undefined,
            createdAt: now,
            updatedAt: now,
            globalFilter: typeof e.globalFilter === 'string' ? e.globalFilter : '',
            applyToAll: !!e.applyToAll,
            deps: e.deps && typeof e.deps === 'object' ? e.deps : {},
        }];
    }
    return out;
}

const filterFileLocks = new Map<string, Promise<unknown>>();

function withFilterFileLock<T>(file: vscode.Uri, fn: () => Promise<T>): Promise<T> {
    const key = file.toString();
    const prev = filterFileLocks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    filterFileLocks.set(key, next);
    next.finally(() => {
        if (filterFileLocks.get(key) === next) {
            filterFileLocks.delete(key);
        }
    });
    return next;
}

async function readFilterFile(file: vscode.Uri): Promise<FilterFile> {
    let buf: Uint8Array;
    try {
        buf = await vscode.workspace.fs.readFile(file);
    } catch (e: any) {
        if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
            return { version: 2, filters: {} };
        }
        throw e;
    }
    return migrateToV2(JSON.parse(Buffer.from(buf).toString('utf8')));
}

async function writeFilterFile(file: vscode.Uri, data: FilterFile): Promise<void> {
    const out = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(file, out);
}

function getFullTableId(target: Target): string {
    return `${target.database}.${target.schema}.${target.name}`;
}

function getAllNodes(compiledJson: DataformCompiledJson) {
    return [
        ...(compiledJson.tables ?? []),
        ...(compiledJson.assertions ?? []),
        ...(compiledJson.operations ?? []),
    ] as (Table | Assertion | Operation)[];
}

/** Resolve the full table ID for the given source file path using compiled JSON. */
function getModelIdForFile(filePath: string, compiledJson: DataformCompiledJson): string | undefined {
    const nodes = getAllNodes(compiledJson);
    // FILE_NODE_MAP keys use the relative path stored in node.fileName
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    const match = nodes.find(n => n.fileName && normalizedFilePath.endsWith(n.fileName.replace(/\\/g, '/').replace(/^\//, '')));
    return match ? getFullTableId(match.target) : undefined;
}

export function createDependencyInspectorPanel(context: vscode.ExtensionContext, initialFilePath?: string): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        'dependencyInspectorPanel',
        'Dependency Inspector',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [Uri.joinPath(context.extensionUri, 'dist')],
        }
    );

    panel.webview.html = getHtmlForWebview(panel.webview, context);

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'appLoaded':
            case 'getModels': {
                let compiledJson: DataformCompiledJson | undefined = globalThis.CACHED_COMPILED_DATAFORM_JSON;
                if (!compiledJson) {
                    panel.webview.postMessage({ type: 'compiling', value: true });
                    const workspaceFolder = await getWorkspaceFolder();
                    if (!workspaceFolder) {
                        panel.webview.postMessage({
                            type: 'error',
                            value: 'No Dataform workspace found. Open a Dataform project folder first.',
                        });
                        return;
                    }
                    compiledJson = await getOrCompileDataformJson(workspaceFolder);
                    if (!compiledJson) {
                        panel.webview.postMessage({
                            type: 'error',
                            value: 'Compilation failed. Check that your Dataform project is valid.',
                        });
                        return;
                    }
                    panel.webview.postMessage({ type: 'compiling', value: false });
                }
                const models = getAllNodes(compiledJson).map(node => ({
                    fullId: getFullTableId(node.target),
                    name: node.target.name,
                    type: (node as any).type ?? 'table',
                }));
                const initialModelId = initialFilePath
                    ? getModelIdForFile(initialFilePath, compiledJson)
                    : undefined;
                panel.webview.postMessage({ type: 'models', value: models, initialModelId });
                return;
            }

            case 'fetchDependencies': {
                const modelFullId: string = message.value?.modelFullId ?? '';
                const maxDepth: number = Math.max(1, Math.min(message.value?.depth ?? 5, 20));
                const compiledJson: DataformCompiledJson | undefined = globalThis.CACHED_COMPILED_DATAFORM_JSON;
                if (!compiledJson) {
                    panel.webview.postMessage({
                        type: 'error',
                        value: 'No compiled Dataform JSON found.',
                    });
                    return;
                }

                // Build a fast lookup map: fullId → node, and a set of assertion IDs to exclude
                const allNodes = getAllNodes(compiledJson);
                const assertionIds = new Set<string>(
                    (compiledJson.assertions ?? []).map(a => getFullTableId(a.target))
                );
                const nodeMap = new Map<string, Table | Assertion | Operation>();
                for (const n of allNodes) {
                    nodeMap.set(getFullTableId(n.target), n);
                }

                // BFS up to maxDepth levels, deduplicating by fullId, skipping assertions
                const visited = new Set<string>([modelFullId]);
                const deps: { fullId: string; name: string; type: string; depth: number }[] = [];
                const edges: { source: string; target: string }[] = [];
                const queue: { fullId: string; depth: number }[] = [{ fullId: modelFullId, depth: 0 }];

                while (queue.length > 0) {
                    const { fullId, depth } = queue.shift()!;
                    if (depth >= maxDepth) { continue; }
                    const node = nodeMap.get(fullId);
                    if (!node) { continue; }

                    for (const depTarget of node.dependencyTargets ?? []) {
                        const depFullId = getFullTableId(depTarget);
                        if (assertionIds.has(depFullId)) { continue; }
                        // Always record the edge even if we've visited the node
                        edges.push({ source: fullId, target: depFullId });
                        if (visited.has(depFullId)) { continue; }
                        visited.add(depFullId);
                        const depNode = nodeMap.get(depFullId);
                        deps.push({
                            fullId: depFullId,
                            name: depTarget.name,
                            type: (depNode as any)?.type ?? 'table',
                            depth: depth + 1,
                        });
                        queue.push({ fullId: depFullId, depth: depth + 1 });
                    }
                }

                panel.webview.postMessage({
                    type: 'dependencies',
                    value: deps,
                    edges,
                    selectedModelId: modelFullId,
                });
                return;
            }

            case 'dryRun': {
                const { tableId, filter }: { tableId: string; filter: string } = message.value ?? {};
                if (!tableId) { return; }
                const query = filter?.trim()
                    ? `SELECT * FROM \`${tableId}\` WHERE ${filter}`
                    : `SELECT * FROM \`${tableId}\``;
                try {
                    const result = await queryDryRun(query);
                    if (result.error.hasError) {
                        panel.webview.postMessage({
                            type: 'dryRunResult',
                            value: { tableId, query, error: result.error.message },
                        });
                    } else {
                        const bytes = result.statistics ? formatBytes(result.statistics.totalBytesProcessed) : undefined;
                        const cost = result.statistics?.cost
                            ? `${result.statistics.cost.value.toFixed(4)} ${result.statistics.cost.currency}`
                            : undefined;
                        panel.webview.postMessage({
                            type: 'dryRunResult',
                            value: { tableId, query, bytes, cost },
                        });
                    }
                } catch (err: any) {
                    panel.webview.postMessage({
                        type: 'dryRunResult',
                        value: { tableId, query, error: err?.message ?? 'Unknown error' },
                    });
                }
                return;
            }

            case 'runQuery': {
                const { tableId, filter }: { tableId: string; filter: string } = message.value ?? {};
                if (!tableId) { return; }
                const query = filter?.trim()
                    ? `SELECT * FROM \`${tableId}\` WHERE ${filter}`
                    : `SELECT * FROM \`${tableId}\``;
                // Notify webview that loading has started
                panel.webview.postMessage({ type: 'queryLoading', value: { tableId } });
                try {
                    const { results, columns, jobStats, errorMessage } = await queryBigQuery(query);
                    panel.webview.postMessage({
                        type: 'queryResult',
                        value: { tableId, query, results, columns, jobStats, errorMessage },
                    });
                } catch (err: any) {
                    panel.webview.postMessage({
                        type: 'queryResult',
                        value: { tableId, query, error: err?.message ?? 'Unknown error' },
                    });
                }
                return;
            }

            case 'getTableSchema': {
                const fullTableId: string = message.value?.fullTableId ?? '';
                const parts = fullTableId.split('.');
                if (parts.length !== 3) {
                    panel.webview.postMessage({
                        type: 'schemaError',
                        value: { fullTableId, error: `Invalid table id: ${fullTableId}` },
                    });
                    return;
                }
                const [projectId, datasetId, tableId] = parts;
                try {
                    const metadata = await fetchTableMetadata(projectId, datasetId, tableId);
                    const fields = metadata?.schema?.fields ?? null;
                    if (!fields) {
                        panel.webview.postMessage({
                            type: 'schemaError',
                            value: { fullTableId, error: 'Schema not available for this table.' },
                        });
                        return;
                    }
                    panel.webview.postMessage({
                        type: 'schema',
                        value: { fullTableId, fields },
                    });
                } catch (err: any) {
                    const detail = err?.message ?? String(err ?? 'Unknown error');
                    panel.webview.postMessage({
                        type: 'schemaError',
                        value: { fullTableId, error: `Failed to fetch table metadata: ${detail}` },
                    });
                }
                return;
            }

            case 'openExternal': {
                const url: string = message.value ?? '';
                if (url.startsWith('https://') || url.startsWith('http://')) {
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
                return;
            }

            case 'saveFiltersToWorkspace': {
                const { modelFullId, filterState, description, presetId } = message.value ?? {};
                if (!modelFullId || !filterState) { return; }
                const ws = await getWorkspaceFolder();
                if (!ws) {
                    panel.webview.postMessage({ type: 'filtersSavedToWorkspace', value: { modelFullId, ok: false, error: 'No Dataform workspace open' } });
                    return;
                }
                const dir = vscode.Uri.joinPath(vscode.Uri.file(ws), '.vscode-dataform-tools');
                const file = vscode.Uri.joinPath(dir, 'dependency-inspector-filters.json');
                try {
                    const result = await withFilterFileLock(file, async () => {
                        await vscode.workspace.fs.createDirectory(dir);
                        const data = await readFilterFile(file);
                        const list = data.filters[modelFullId] ?? [];
                        const now = new Date().toISOString();
                        const trimmedDescription = typeof description === 'string' && description.trim() ? description.trim() : undefined;
                        const idx = presetId ? list.findIndex(p => p.id === presetId) : -1;
                        let savedPreset: FilterPreset;
                        if (idx >= 0) {
                            savedPreset = {
                                ...list[idx],
                                description: trimmedDescription,
                                updatedAt: now,
                                globalFilter: filterState.globalFilter ?? '',
                                applyToAll: !!filterState.applyToAll,
                                deps: filterState.deps ?? {},
                            };
                            list[idx] = savedPreset;
                        } else {
                            savedPreset = {
                                id: randomUUID(),
                                description: trimmedDescription,
                                createdAt: now,
                                updatedAt: now,
                                globalFilter: filterState.globalFilter ?? '',
                                applyToAll: !!filterState.applyToAll,
                                deps: filterState.deps ?? {},
                            };
                            list.push(savedPreset);
                        }
                        data.filters[modelFullId] = list;
                        await writeFilterFile(file, data);
                        return { savedPreset, overwrote: idx >= 0 };
                    });
                    panel.webview.postMessage({
                        type: 'filtersSavedToWorkspace',
                        value: { modelFullId, ok: true, presetId: result.savedPreset.id, overwrote: result.overwrote, path: file.fsPath },
                    });
                } catch (e: any) {
                    panel.webview.postMessage({ type: 'filtersSavedToWorkspace', value: { modelFullId, ok: false, error: e?.message ?? String(e) } });
                }
                return;
            }

            case 'getLatestFilterPreset': {
                const { modelFullId } = message.value ?? {};
                if (!modelFullId) { return; }
                const ws = await getWorkspaceFolder();
                if (!ws) { return; }
                const file = vscode.Uri.joinPath(vscode.Uri.file(ws), '.vscode-dataform-tools', 'dependency-inspector-filters.json');
                const data = await readFilterFile(file);
                const list = data.filters[modelFullId] ?? [];
                if (list.length === 0) { return; }
                const latest = list.reduce((a, b) =>
                    new Date(b.updatedAt).getTime() > new Date(a.updatedAt).getTime() ? b : a
                );
                panel.webview.postMessage({
                    type: 'filtersLoadedFromWorkspace',
                    value: {
                        modelFullId,
                        state: {
                            globalFilter: latest.globalFilter,
                            applyToAll: latest.applyToAll,
                            deps: latest.deps,
                        },
                        description: latest.description,
                        presetId: latest.id,
                        auto: true,
                    },
                });
                return;
            }

            case 'loadFiltersFromWorkspace': {
                const { modelFullId } = message.value ?? {};
                if (!modelFullId) { return; }
                const ws = await getWorkspaceFolder();
                if (!ws) {
                    panel.webview.postMessage({ type: 'filtersLoadedFromWorkspace', value: { modelFullId, state: null, error: 'No Dataform workspace open' } });
                    return;
                }
                const file = vscode.Uri.joinPath(vscode.Uri.file(ws), '.vscode-dataform-tools', 'dependency-inspector-filters.json');
                const data = await readFilterFile(file);
                let list = data.filters[modelFullId] ?? [];
                if (list.length === 0) {
                    panel.webview.postMessage({ type: 'filtersLoadedFromWorkspace', value: { modelFullId, state: null, missing: true } });
                    return;
                }

                type Item = vscode.QuickPickItem & { presetId: string };
                const buildItems = (l: FilterPreset[]): Item[] =>
                    l.map(p => ({
                        label: p.description || `Filter ${p.id.slice(0, 8)}`,
                        description: new Date(p.updatedAt).toLocaleString(),
                        detail: p.globalFilter ? p.globalFilter.slice(0, 200) : '(no global filter)',
                        presetId: p.id,
                        buttons: [{ iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete preset' }],
                    }));

                const qp = vscode.window.createQuickPick<Item>();
                qp.title = `Saved filters for ${modelFullId}`;
                qp.placeholder = 'Select a filter to apply (click trash icon to delete)';
                qp.items = buildItems(list);

                qp.onDidTriggerItemButton(async e => {
                    try {
                        const updated = await withFilterFileLock(file, async () => {
                            const fresh = await readFilterFile(file);
                            const next = (fresh.filters[modelFullId] ?? []).filter(p => p.id !== e.item.presetId);
                            fresh.filters[modelFullId] = next;
                            await writeFilterFile(file, fresh);
                            return next;
                        });
                        list = updated;
                        panel.webview.postMessage({ type: 'filterPresetDeleted', value: { modelFullId, presetId: e.item.presetId } });
                        if (list.length === 0) {
                            qp.hide();
                            return;
                        }
                        qp.items = buildItems(list);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to delete preset: ${err?.message ?? err}`);
                    }
                });

                qp.onDidAccept(() => {
                    const sel = qp.selectedItems[0];
                    if (sel) {
                        const preset = list.find(p => p.id === sel.presetId);
                        if (preset) {
                            panel.webview.postMessage({
                                type: 'filtersLoadedFromWorkspace',
                                value: {
                                    modelFullId,
                                    state: {
                                        globalFilter: preset.globalFilter,
                                        applyToAll: preset.applyToAll,
                                        deps: preset.deps,
                                    },
                                    description: preset.description,
                                    presetId: preset.id,
                                },
                            });
                        }
                    }
                    qp.hide();
                });

                qp.onDidHide(() => qp.dispose());
                qp.show();
                return;
            }
        }
    });

    return panel;
}

function getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {
    const scriptUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'dist', 'dependency-inspector.js'));
    const styleUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'dist', 'dependency-inspector.css'));
    // StyledSelect.css is a shared Vite chunk that contains @xyflow/react styles
    const sharedStyleUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'dist', 'StyledSelect.css'));
    const nonce = getNonce();

    return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
            <link href="${sharedStyleUri}" rel="stylesheet">
            <link href="${styleUri}" rel="stylesheet">
            <title>Dependency Inspector</title>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
        </body>
        </html>
    `;
}
