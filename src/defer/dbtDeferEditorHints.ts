import path from 'path';
import * as vscode from 'vscode';
import { DbtRefRead, dbtRefReads } from '../backend/dbt';
import { debounce } from '../debounce';
import { logger } from '../logger';
import { dbtCompileDefer, dbtCompileState, dbtSettings, onDidChangeDbtCompile } from '../project/dbtCompile';
import { dbtDeferToProdState, dbtDeferralOf } from '../project/dbtDefer';
import { onDidHoldTable } from '../project/dbtSchemas';
import { dbtFileOfDocument } from '../project/dbtWithoutPanel';
import { projects } from '../project';
import type { ProjectState } from '../project/registry';
import { ActionId, isTestKind } from '../shared/compiledGraph';
import { DbtRefHint, dbtRefHints } from './dbtRefHints';
import { builtInDevDecoration, deferredDecoration, hintsEnabled } from './deferEditorHints';

/*
 * The labels after each `ref()` in a .sql file of a dbt Project, with defer to prod on (see dbtRefHints.ts for what
 * they say). They are the same decorations, colours and setting as a Dataform file's.
 *
 * dbt compiles one file at a time, so what a file's `ref()`s read is kept from that file's own last compile, until
 * it is compiled again or the compile defers to something else. Nothing here asks BigQuery or runs dbt: the age of a
 * table in the dbt target is shown when a hover or a completion has already asked for it.
 */

/** What the last compile of a file read each upstream table from, and what that compile deferred to */
interface FileReads {
    /** The prod manifest and the dbt target of the compile: another of either is another answer */
    madeWith: string;
    reads: Record<ActionId, DbtRefRead>;
}

/** By Project root, then by file relative to it */
const readsByFile = new Map<string, Map<string, FileReads>>();
/** By Project root and Action: when its table in the dbt target was last built, as BigQuery last said. Kept across compiles */
const lastModified = new Map<string, number>();
const ageKey = (root: string, id: ActionId) => `${root}\n${id}`;

/** Takes what the Project's last compile read from prod for the files it compiled, and drops what an earlier compile deferred elsewhere said */
function remember(project: ProjectState) {
    const { root } = project;
    const defer = dbtCompileDefer(root);
    const last = project.dbtBackend?.lastResult;
    if (!last || !defer || 'error' in defer) {
        readsByFile.delete(root);
        return;
    }
    const madeWith = `${defer.stateDir}\n${dbtSettings(root).target ?? last.target ?? ''}`;
    const ofProject = readsByFile.get(root) ?? new Map<string, FileReads>();
    readsByFile.set(root, ofProject);
    for (const [file, kept] of ofProject) {
        if (kept.madeWith !== madeWith) {
            ofProject.delete(file);
        }
    }
    const compiled = new Map<string, ActionId[]>();
    for (const action of Object.values(last.graph.actions)) {
        if (action.fileName && action.sqlPresent && action.sections.length > 0 && !isTestKind(action.kind)) {
            compiled.set(action.fileName, [...(compiled.get(action.fileName) ?? []), action.id]);
        }
    }
    for (const [file, ids] of compiled) {
        const deferral = dbtDeferralOf(project, defer, ids);
        if (deferral) {
            ofProject.set(file, { madeWith, reads: dbtRefReads(deferral) });
        }
    }
}

function deferApplied(project: ProjectState): boolean {
    const state = dbtDeferToProdState(project.root, dbtSettings(project.root).target ?? project.dbtBackend?.lastResult?.target);
    return state.enabled && state.available;
}

/**
 * The labels of the `ref()`s of a document, as things stand. Undefined for a document that is not a .sql file of a
 * dbt Project, which is not this module's to draw in.
 */
export function dbtRefHintsOf(document: vscode.TextDocument): DbtRefHint[] | undefined {
    const dbt = path.extname(document.fileName).toLowerCase() === '.sql' ? dbtFileOfDocument(document) : undefined;
    if (!dbt) {
        return undefined;
    }
    // What is kept is of a compile that deferred: it is not shown once defer to prod is switched off, which no compile need follow
    const kept = hintsEnabled() && deferApplied(dbt.project) ? readsByFile.get(dbt.project.root)?.get(dbt.file) : undefined;
    const resolver = dbt.project.dbtBackend?.editor;
    if (!kept || !resolver) {
        return [];
    }
    const text = document.getText();
    return dbtRefHints(text, (offset) => resolver.tableAt({ file: dbt.file, text, offset })?.id, kept.reads, (id) => lastModified.get(ageKey(dbt.project.root, id)), Date.now());
}

function decorate(editor: vscode.TextEditor) {
    const document = editor.document;
    const hints = dbtRefHintsOf(document);
    if (!hints) {
        return;
    }
    const decorations = (kind: DbtRefHint['kind']): vscode.DecorationOptions[] => hints.filter((hint) => hint.kind === kind).map((hint) => ({
        range: new vscode.Range(document.positionAt(hint.start), document.positionAt(hint.end)),
        hoverMessage: new vscode.MarkdownString(hint.hover),
        renderOptions: { after: { contentText: ` ${hint.label} ` } },
    }));
    editor.setDecorations(deferredDecoration, decorations('prod'));
    editor.setDecorations(builtInDevDecoration, decorations('dev'));
}

function decorateVisible(root?: string) {
    for (const editor of vscode.window.visibleTextEditors) {
        if (root !== undefined && !editor.document.uri.fsPath.startsWith(root + path.sep)) {
            continue;
        }
        try {
            decorate(editor);
        } catch (error) {
            logger.error(`dbt: could not show the defer to prod labels of ${editor.document.fileName}: ${error}`);
        }
    }
}

export function registerDbtDeferEditorHints(context: vscode.ExtensionContext) {
    // A ref moves as the file is edited; what it reads only changes with a compile
    const redrawByDocument = new Map<string, () => void>();
    context.subscriptions.push(
        onDidChangeDbtCompile((root) => {
            if (dbtCompileState(root).compiling) {
                return;
            }
            const project = projects.projects.find((each) => each.root === root && each.backend === 'dbt');
            if (project) {
                remember(project);
            } else {
                readsByFile.delete(root);
            }
            decorateVisible(root);
        }),
        onDidHoldTable(({ root, key, table }) => {
            const known = table.state === 'found' ? table.lastModified : undefined;
            const before = lastModified.get(ageKey(root, key));
            if (table.state === 'unknown' || known === before) {
                return;
            }
            if (known === undefined) {
                lastModified.delete(ageKey(root, key));
            } else {
                lastModified.set(ageKey(root, key), known);
            }
            decorateVisible(root);
        }),
        vscode.window.onDidChangeVisibleTextEditors(() => decorateVisible()),
        vscode.workspace.onDidCloseTextDocument((document) => redrawByDocument.delete(document.uri.toString())),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.scheme !== 'file' || path.extname(event.document.fileName).toLowerCase() !== '.sql') {
                return;
            }
            const key = event.document.uri.toString();
            let redraw = redrawByDocument.get(key);
            if (!redraw) {
                redraw = debounce(() => vscode.window.visibleTextEditors.filter((editor) => editor.document === event.document).forEach(decorate), 300);
                redrawByDocument.set(key, redraw);
            }
            redraw();
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (['deferToProdEditorHints', 'deferToProd', 'dbtProdTarget'].some((setting) => event.affectsConfiguration(`vscode-dataform-tools.${setting}`))) {
                decorateVisible();
            }
        }),
    );
    decorateVisible();
}
