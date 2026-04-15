import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { getNonce, formatBytes, getWorkspaceFolder, getOrCompileDataformJson } from '../utils';
import { queryDryRun } from '../bigqueryDryRun';
import { queryBigQuery } from '../bigqueryRunQuery';
import { DataformCompiledJson, Target, Table, Assertion, Operation } from '../types';

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
    const match = nodes.find(n => n.fileName && filePath.endsWith(n.fileName.replace(/^\//, '')));
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
                const compiledJson: DataformCompiledJson | undefined = globalThis.CACHED_COMPILED_DATAFORM_JSON;
                if (!compiledJson) {
                    panel.webview.postMessage({
                        type: 'error',
                        value: 'No compiled Dataform JSON found.',
                    });
                    return;
                }
                const node = getAllNodes(compiledJson).find(n => getFullTableId(n.target) === modelFullId);
                if (!node) {
                    panel.webview.postMessage({ type: 'dependencies', value: [] });
                    return;
                }
                const deps = (node.dependencyTargets ?? []).map(t => ({
                    fullId: getFullTableId(t),
                    name: t.name,
                    type: 'table',
                }));
                panel.webview.postMessage({
                    type: 'dependencies',
                    value: deps,
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

            case 'openExternal': {
                const url: string = message.value ?? '';
                if (url.startsWith('https://') || url.startsWith('http://')) {
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
                return;
            }
        }
    });

    return panel;
}

function getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {
    const scriptUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'dist', 'dependency-inspector.js'));
    const styleUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'dist', 'dependency-inspector.css'));
    const nonce = getNonce();

    return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
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
