import * as vscode from 'vscode';
import { compiledIndices, compiledJson } from '../project';
import { logger } from '../logger';
import { debounce } from '../debounce';
import { Target } from '../types';
import { findRefs } from '../documentSymbols';
import { getRelativePath } from '../utils/workspaceUtils';
import { slashPath } from '../shared/compiledGraph';
import { builtInDevHint, declarationHint, deferralEntryHint, DeferralEntryHint, indexGraphActions, matchRef, RefHintKind, targetId, upstreamDeclarations } from './deferRules';
import { Deferral, findLeftoverProxies, isDeferEnabled, onDeferralResolved, onDeferralUpdated, resolveDeferralWithStaleFlags } from './index';
import { extensionConfiguration } from '../project/settings';
import { deferHoverMarkdown } from '../shared/deferHover';

/*
 * A coloured label after each `${ref(...)}` in a .sqlx file that defer to prod reads from prod or from its built
 * Dev Target, that names a declaration, or that a leftover Proxy View makes read prod. Inlay hints all share one theme colour, so these are decorations with
 * their own theme colours. Worked out from the cached compile and the shared table lookup cache, so they add no
 * compile and, while defer to prod is off and no proxy views exist, no BigQuery calls. Stale Deferral flags can
 * land after the hints are drawn, so a document's hints are redrawn once they do.
 */

/** `label` takes the time it is drawn at, so a dev table's age stays current across redraws of cached hints */
type RefHint = {
    label: (now: number) => string,
    kind: RefHintKind,
    hover: vscode.MarkdownString,
    /** The Prod Target the ref reads, when it is read from prod */
    prod?: Target,
};
type DocumentHints = { hints: Map<string, RefHint>, dependencies: { target: Target, canonicalTarget?: Target }[] };

export const deferredDecoration = vscode.window.createTextEditorDecorationType({
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
export const builtInDevDecoration = vscode.window.createTextEditorDecorationType({
    after: {
        margin: "0 0 0 0.75em",
        color: new vscode.ThemeColor("dataformTools.builtInDevRef.foreground"),
        backgroundColor: new vscode.ThemeColor("dataformTools.builtInDevRef.background"),
        fontWeight: "600",
    },
});

export function hintsEnabled(): boolean {
    return extensionConfiguration().get<boolean>('deferToProdEditorHints') !== false;
}

/** A ref's hover: its HTML drawn (coloured spans, see src/shared/deferHover.ts), its icons, and only `trustedCommands` run */
export function deferHover(text: string, trustedCommands: string[] = []): vscode.MarkdownString {
    const hover = new vscode.MarkdownString(text);
    hover.isTrusted = trustedCommands.length > 0 ? { enabledCommands: trustedCommands } : false;
    hover.supportHtml = true;
    hover.supportThemeIcons = true;
    return hover;
}

/** `declared` are the document's upstream declarations, which get a hint when no deferral entry covers them */
function deferralHints(deferral: Deferral | undefined, declared: Target[]): Map<string, RefHint> {
    const hints = new Map<string, RefHint>();
    const add = (dev: string, { label, kind, hover }: DeferralEntryHint, labelAt: (now: number) => string = () => label, prod?: Target) =>
        hints.set(dev, { label: labelAt, kind, hover: deferHover(hover), prod });
    for (const entry of deferral?.builtInDev ?? []) {
        add(targetId(entry.dev), builtInDevHint(entry, Date.now()), (now) => builtInDevHint(entry, now).label);
    }
    for (const entry of deferral?.entries ?? []) {
        const hint = deferralEntryHint(entry);
        add(targetId(entry.dev), hint, () => hint.label, entry.status === "deferred" ? entry.prod : undefined);
    }
    for (const target of declared) {
        if (!hints.has(targetId(target))) {
            add(targetId(target), declarationHint(target));
        }
    }
    return hints;
}

/**
 * What each upstream Dev Target of the document reads, keyed by target id. `onStaleFlags` gets the hints again
 * when Stale Deferral flags arrive after this resolves.
 */
async function computeDocumentHints(document: vscode.TextDocument, onStaleFlags: (hints: DocumentHints) => void): Promise<DocumentHints | undefined> {
    const workspaceFolder = globalThis.workspaceFolder;
    const graph = compiledJson();
    if (!workspaceFolder || !graph) {
        return undefined;
    }
    const actions = (compiledIndices().fileNodeMap.get(slashPath(getRelativePath(document.uri.fsPath))) ?? []).filter((action: any) => action?.target && action.type !== "test");
    if (actions.length === 0) {
        return undefined;
    }
    const graphActions = indexGraphActions(graph);
    const dependencies = actions
        .flatMap((action: any) => action.dependencyTargets ?? [])
        .map((dependency: Target) => graphActions.get(targetId(dependency)) ?? { target: dependency });

    if (isDeferEnabled(workspaceFolder)) {
        const declared = upstreamDeclarations(dependencies, graph);
        const { deferral, staleFlags } = await resolveDeferralWithStaleFlags(actions, graph, workspaceFolder);
        // The flags are set on the entries of this same deferral
        staleFlags?.then((flagged) => {
            if (flagged) {
                onStaleFlags({ hints: deferralHints(deferral, declared), dependencies });
            }
        });
        return { hints: deferralHints(deferral, declared), dependencies };
    }
    const hints = new Map<string, RefHint>();
    for (const proxy of await findLeftoverProxies(actions)) {
        hints.set(targetId(proxy), {
            label: () => "⚠ prod · leftover proxy view",
            kind: "warning",
            hover: deferHover(
                deferHoverMarkdown({
                    tone: "warning",
                    icon: "warning",
                    heading: "prod",
                    caption: "DEFER TO PROD IS OFF",
                    sentence: "A proxy view from an earlier deferred run, so it reads prod.",
                    dev: targetId(proxy),
                    footer: ['[Defer to prod options](command:vscode-dataform-tools.deferToProdActions)'],
                }),
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

    /** What each upstream table of the document reads, worked out once per compile or setting change */
    hintsOf(document: vscode.TextDocument): Promise<DocumentHints | undefined> {
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
        return pending;
    }

    async decorate(editor: vscode.TextEditor) {
        const document = editor.document;
        if (document.languageId !== 'sqlx') {
            return;
        }
        const data = hintsEnabled() ? await this.hintsOf(document) : undefined;

        const byKind: Record<RefHintKind, vscode.DecorationOptions[]> = { prod: [], warning: [], dev: [] };
        if (data && data.hints.size > 0) {
            const now = Date.now();
            for (const ref of findRefs(document.getText())) {
                const target = matchRef(ref.args, data.dependencies);
                const hint = target && data.hints.get(targetId(target));
                if (!hint) {
                    continue;
                }
                // From after the table name's closing quote: the hover of the name itself is the table's, which
                // shows this hover above the table's details (src/hoverProvider.ts), so the two are not both shown
                const nameEnd = /["']\s*\)\s*\}$/.exec(document.getText().slice(ref.index, ref.index + ref.length));
                const start = ref.index + ref.length - (nameEnd ? nameEnd[0].length - 1 : 0);
                const decoration: vscode.DecorationOptions = {
                    range: new vscode.Range(document.positionAt(start), document.positionAt(ref.index + ref.length)),
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

let editorHints: DeferEditorHints | undefined;

/**
 * What defer to prod says of a ref of the document to `devTarget`, for the ref's table hover: the hover of its label,
 * to show above the table, and the Prod Target it reads, whose table the hover is then of, as the dev table is not
 * built. Undefined when the ref has no label, as when the hints are turned off.
 */
export async function deferHintOfRef(document: vscode.TextDocument, devTarget: Target): Promise<{ hover: vscode.MarkdownString, prod?: Target } | undefined> {
    if (!editorHints || !hintsEnabled() || document.languageId !== 'sqlx') {
        return undefined;
    }
    return (await editorHints.hintsOf(document))?.hints.get(targetId(devTarget));
}

export function registerDeferEditorHints(context: vscode.ExtensionContext) {
    const hints = new DeferEditorHints();
    editorHints = hints;
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
