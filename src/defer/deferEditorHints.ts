import * as vscode from 'vscode';
import { logger } from '../logger';
import { debounce } from '../debounce';
import { Target } from '../types';
import { findRefs } from '../documentSymbols';
import { getRelativePath } from '../utils/workspaceUtils';
import { builtInDevHint, deferralEntryHint, DeferralEntryHint, indexGraphActions, matchRef, RefHintKind, targetId } from './deferRules';
import { Deferral, findLeftoverProxies, isDeferEnabled, onDeferralResolved, onDeferralUpdated, resolveDeferralWithStaleFlags } from './index';

/*
 * A coloured label after each `${ref(...)}` in a .sqlx file that defer to prod reads from prod or from its built
 * Dev Target, or that a leftover Proxy View makes read prod. Inlay hints all share one theme colour, so these are decorations with
 * their own theme colours. Worked out from the cached compile and the shared table lookup cache, so they add no
 * compile and, while defer to prod is off and no proxy views exist, no BigQuery calls. Stale Deferral flags can
 * land after the hints are drawn, so a document's hints are redrawn once they do.
 */

/** `label` takes the time it is drawn at, so a dev table's age stays current across redraws of cached hints */
type RefHint = { label: (now: number) => string, kind: RefHintKind, hover: vscode.MarkdownString };
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
const builtInDevDecoration = vscode.window.createTextEditorDecorationType({
    after: {
        margin: "0 0 0 0.75em",
        color: new vscode.ThemeColor("dataformTools.builtInDevRef.foreground"),
        backgroundColor: new vscode.ThemeColor("dataformTools.builtInDevRef.background"),
        fontWeight: "600",
    },
});

function hintsEnabled(): boolean {
    return vscode.workspace.getConfiguration('vscode-dataform-tools').get<boolean>('deferToProdEditorHints') !== false;
}

function markdown(text: string, trustedCommands: string[] = []): vscode.MarkdownString {
    const hover = new vscode.MarkdownString(text);
    hover.isTrusted = trustedCommands.length > 0 ? { enabledCommands: trustedCommands } : false;
    return hover;
}

function deferralHints(deferral: Deferral | undefined): Map<string, RefHint> {
    const hints = new Map<string, RefHint>();
    const add = (dev: string, { label, kind, hover }: DeferralEntryHint, labelAt: (now: number) => string = () => label) =>
        hints.set(dev, { label: labelAt, kind, hover: markdown(hover) });
    for (const entry of deferral?.builtInDev ?? []) {
        add(targetId(entry.dev), builtInDevHint(entry, Date.now()), (now) => builtInDevHint(entry, now).label);
    }
    for (const entry of deferral?.entries ?? []) {
        add(targetId(entry.dev), deferralEntryHint(entry));
    }
    return hints;
}

/**
 * What each upstream Dev Target of the document reads, keyed by target id. `onStaleFlags` gets the hints again
 * when Stale Deferral flags arrive after this resolves.
 */
async function computeDocumentHints(document: vscode.TextDocument, onStaleFlags: (hints: DocumentHints) => void): Promise<DocumentHints | undefined> {
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

    if (isDeferEnabled(workspaceFolder)) {
        const { deferral, staleFlags } = await resolveDeferralWithStaleFlags(actions, graph, workspaceFolder);
        // The flags are set on the entries of this same deferral
        staleFlags?.then((flagged) => {
            if (flagged) {
                onStaleFlags({ hints: deferralHints(deferral), dependencies });
            }
        });
        return { hints: deferralHints(deferral), dependencies };
    }
    const hints = new Map<string, RefHint>();
    for (const proxy of await findLeftoverProxies(actions)) {
        hints.set(targetId(proxy), {
            label: () => "⚠ prod · leftover proxy view",
            kind: "warning",
            hover: markdown(
                `**Defer to prod is off**, but \`${targetId(proxy)}\` is a proxy view from an earlier deferred run, so it reads prod.\n\n[Defer to prod options](command:vscode-dataform-tools.deferToProdActions)`,
                ['vscode-dataform-tools.deferToProdActions'],
            ),
        });
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

    decorateDocument(document: vscode.TextDocument) {
        vscode.window.visibleTextEditors
            .filter((editor) => editor.document === document)
            .forEach((editor) => this.decorate(editor).catch(() => undefined));
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
                const computing: Promise<DocumentHints | undefined> = computeDocumentHints(document, (upgraded) => {
                    // Dropped when a compile or setting change has since replaced these hints
                    if (this.cache.get(key) !== computing) {
                        return;
                    }
                    this.cache.set(key, Promise.resolve(upgraded));
                    this.decorateDocument(document);
                });
                pending = computing;
                this.cache.set(key, pending);
            }
            data = await pending;
        }

        const byKind: Record<RefHintKind, vscode.DecorationOptions[]> = { prod: [], warning: [], dev: [] };
        if (data && data.hints.size > 0) {
            const now = Date.now();
            for (const ref of findRefs(document.getText())) {
                const target = matchRef(ref.args, data.dependencies);
                const hint = target && data.hints.get(targetId(target));
                if (!hint) {
                    continue;
                }
                const decoration: vscode.DecorationOptions = {
                    range: new vscode.Range(document.positionAt(ref.index), document.positionAt(ref.index + ref.length)),
                    hoverMessage: hint.hover,
                    renderOptions: { after: { contentText: ` ${hint.label(now)} ` } },
                };
                byKind[hint.kind].push(decoration);
            }
        }
        editor.setDecorations(deferredDecoration, byKind.prod);
        editor.setDecorations(warningDecoration, byKind.warning);
        editor.setDecorations(builtInDevDecoration, byKind.dev);
    }
}

export function registerDeferEditorHints(context: vscode.ExtensionContext) {
    const hints = new DeferEditorHints();
    // Refs move as the file is edited; the deferral itself only changes on a compile or setting change.
    // Debounced per document, so editing one file does not swallow the redraw of another.
    const redecorateByDocument = new Map<string, (document: vscode.TextDocument) => void>();
    const redecorateOnEdit = (document: vscode.TextDocument) => {
        const key = document.uri.toString();
        let redecorate = redecorateByDocument.get(key);
        if (!redecorate) {
            redecorate = debounce((changed: vscode.TextDocument) => hints.decorateDocument(changed), 300);
            redecorateByDocument.set(key, redecorate);
        }
        redecorate(document);
    };
    context.subscriptions.push(
        deferredDecoration,
        warningDecoration,
        builtInDevDecoration,
        onDeferralResolved(() => hints.refresh()),
        onDeferralUpdated(() => hints.refresh()),
        vscode.window.onDidChangeVisibleTextEditors(() => hints.decorateVisibleEditors()),
        vscode.workspace.onDidCloseTextDocument((document) => redecorateByDocument.delete(document.uri.toString())),
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
