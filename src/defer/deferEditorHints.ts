import * as vscode from 'vscode';
import { logger } from '../logger';
import { debounce } from '../debounce';
import { Target } from '../types';
import { findRefs } from '../documentSymbols';
import { getRelativePath } from '../utils/workspaceUtils';
import { indexGraphActions, matchRef, targetId } from './deferRules';
import { findLeftoverProxies, isDeferEnabled, onDeferralResolved, onDeferralUpdated, resolveDeferralForActions } from './index';

/*
 * A coloured label after each `${ref(...)}` in a .sqlx file that defer to prod reads from prod, or that a
 * leftover Proxy View makes read prod. Inlay hints all share one theme colour, so these are decorations with
 * their own theme colours. Worked out from the cached compile and the shared table lookup cache, so they add no
 * compile and, while defer to prod is off and no proxy views exist, no BigQuery calls.
 */

type RefHint = { label: string, warning: boolean, hover: vscode.MarkdownString };
type DocumentHints = { hints: Map<string, RefHint>, dependencies: { target: Target, canonicalTarget?: Target }[] };

const deferredDecoration = vscode.window.createTextEditorDecorationType({
    after: {
        margin: "0 0 0 0.75em",
        color: new vscode.ThemeColor("dataformTools.deferredRef.foreground"),
        backgroundColor: new vscode.ThemeColor("dataformTools.deferredRef.background"),
        fontWeight: "600",
    },
});
const warningDecoration = vscode.window.createTextEditorDecorationType({
    after: {
        margin: "0 0 0 0.75em",
        color: new vscode.ThemeColor("dataformTools.deferredRefWarning.foreground"),
        backgroundColor: new vscode.ThemeColor("dataformTools.deferredRefWarning.background"),
        fontWeight: "600",
    },
});

function bigQueryConsoleUrl(target: Target): string {
    return `https://console.cloud.google.com/bigquery?project=${target.database}&ws=!1m5!1m4!4m3!1s${target.database}!2s${target.schema}!3s${target.name}`;
}

function hintsEnabled(): boolean {
    return vscode.workspace.getConfiguration('vscode-dataform-tools').get<boolean>('deferToProdEditorHints') !== false;
}

function markdown(text: string, trustedCommands: string[] = []): vscode.MarkdownString {
    const hover = new vscode.MarkdownString(text);
    hover.isTrusted = trustedCommands.length > 0 ? { enabledCommands: trustedCommands } : false;
    return hover;
}

/** What each upstream Dev Target of the document reads, keyed by target id */
async function computeDocumentHints(document: vscode.TextDocument): Promise<DocumentHints | undefined> {
    const workspaceFolder = globalThis.workspaceFolder;
    const graph = CACHED_COMPILED_DATAFORM_JSON;
    if (!workspaceFolder || !graph) {
        return undefined;
    }
    const actions = (FILE_NODE_MAP.get(getRelativePath(document.uri.fsPath)) ?? []).filter((action: any) => action?.target && action.type !== "test");
    if (actions.length === 0) {
        return undefined;
    }
    const graphActions = indexGraphActions(graph);
    const dependencies = actions
        .flatMap((action: any) => action.dependencyTargets ?? [])
        .map((dependency: Target) => graphActions.get(targetId(dependency)) ?? { target: dependency });

    const hints = new Map<string, RefHint>();
    if (isDeferEnabled(workspaceFolder)) {
        const deferral = await resolveDeferralForActions(actions, graph, workspaceFolder);
        for (const entry of deferral?.entries ?? []) {
            const route = entry.prod ? `\`${targetId(entry.dev)}\`\n\n→ \`${targetId(entry.prod)}\`` : `\`${targetId(entry.dev)}\``;
            const openProd = entry.prod ? `\n\n[Open prod table in BigQuery](${bigQueryConsoleUrl(entry.prod)})` : "";
            if (entry.status === "deferred" && entry.stale) {
                hints.set(targetId(entry.dev), { label: "⚠ prod (changed on branch)", warning: true, hover: markdown(`**Defer to prod:** read from prod, but changed on this branch, so prod may be out of date.\n\n${route}${openProd}`) });
            } else if (entry.status === "deferred") {
                hints.set(targetId(entry.dev), { label: "→ prod", warning: false, hover: markdown(`**Defer to prod:** not built in dev, so read from prod.\n\n${route}${openProd}`) });
            } else {
                const why = entry.status === "unreadable" ? "not built in dev, and no read access to prod." : "not built in dev or prod.";
                hints.set(targetId(entry.dev), { label: "⚠ not built", warning: true, hover: markdown(`**Defer to prod:** ${why}\n\n${route}`) });
            }
        }
    } else {
        for (const proxy of await findLeftoverProxies(actions)) {
            hints.set(targetId(proxy), {
                label: "⚠ proxy → prod",
                warning: true,
                hover: markdown(
                    `**Defer to prod is off**, but \`${targetId(proxy)}\` is a proxy view from an earlier deferred run, so it reads prod.\n\n[Defer to prod options](command:vscode-dataform-tools.deferToProdActions)`,
                    ['vscode-dataform-tools.deferToProdActions'],
                ),
            });
        }
    }
    return { hints, dependencies };
}

class DeferEditorHints {
    /** Per document, cleared whenever the deferral may have changed; refs are re-found on every edit */
    private cache = new Map<string, Promise<DocumentHints | undefined>>();

    refresh() {
        this.cache.clear();
        this.decorateVisibleEditors();
    }

    decorateVisibleEditors() {
        for (const editor of vscode.window.visibleTextEditors) {
            this.decorate(editor).catch((error) => logger.error(`Defer to prod: could not show editor hints: ${error?.message}`));
        }
    }

    async decorate(editor: vscode.TextEditor) {
        const document = editor.document;
        if (document.languageId !== 'sqlx') {
            return;
        }
        let data: DocumentHints | undefined;
        if (hintsEnabled()) {
            const key = document.uri.toString();
            let pending = this.cache.get(key);
            if (!pending) {
                pending = computeDocumentHints(document);
                this.cache.set(key, pending);
            }
            data = await pending;
        }

        const deferred: vscode.DecorationOptions[] = [];
        const warnings: vscode.DecorationOptions[] = [];
        if (data && data.hints.size > 0) {
            for (const ref of findRefs(document.getText())) {
                const target = matchRef(ref.args, data.dependencies);
                const hint = target && data.hints.get(targetId(target));
                if (!hint) {
                    continue;
                }
                const decoration: vscode.DecorationOptions = {
                    range: new vscode.Range(document.positionAt(ref.index), document.positionAt(ref.index + ref.length)),
                    hoverMessage: hint.hover,
                    renderOptions: { after: { contentText: ` ${hint.label} ` } },
                };
                (hint.warning ? warnings : deferred).push(decoration);
            }
        }
        editor.setDecorations(deferredDecoration, deferred);
        editor.setDecorations(warningDecoration, warnings);
    }
}

export function registerDeferEditorHints(context: vscode.ExtensionContext) {
    const hints = new DeferEditorHints();
    // Refs move as the file is edited; the deferral itself only changes on a compile or setting change
    const redecorateOnEdit = debounce((document: vscode.TextDocument) => {
        vscode.window.visibleTextEditors
            .filter((editor) => editor.document === document)
            .forEach((editor) => hints.decorate(editor).catch(() => undefined));
    }, 300);
    context.subscriptions.push(
        deferredDecoration,
        warningDecoration,
        onDeferralResolved(() => hints.refresh()),
        onDeferralUpdated(() => hints.refresh()),
        vscode.window.onDidChangeVisibleTextEditors(() => hints.decorateVisibleEditors()),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'sqlx') {
                redecorateOnEdit(event.document);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (['deferToProd', 'prodCompilerOptions', 'deferToProdEditorHints'].some((setting) => event.affectsConfiguration(`vscode-dataform-tools.${setting}`))) {
                hints.refresh();
            }
        }),
    );
    hints.decorateVisibleEditors();
}
