import * as vscode from 'vscode';
import { CteChoice, cteChoiceAt, cteChoices } from './bigquery/ctePreview';
import { previewDataformCte } from './previewQueryResults';
import { dbtPreviewFile } from './project/dbtCommands';
import { extensionConfiguration } from './project/settings';
import { isScratchPath } from './scratch/scratchQuery';
import { dbtFileOf } from './views/register-preview-compiled-panel';

/*
 * Previewing the rows of one CTE of a query, from a CodeLens above it, the light bulb in it, the editor's context
 * menu or the command palette. The query is built in src/bigquery/ctePreview.ts.
 */

export const PREVIEW_CTE_COMMAND = 'vscode-dataform-tools.previewCte';

const isSqlx = (document: vscode.TextDocument) => document.uri.fsPath.endsWith('.sqlx');
/** A scratch query is run whole with its own command, and a dbt Project's folder can hold them */
const isScratch = (document: vscode.TextDocument) => isScratchPath(document.uri.fsPath);

/** `▶ Preview CTE` above each CTE that can be previewed, unless the `ctePreviewCodeLens` setting is off */
export class CtePreviewCodeLensProvider implements vscode.CodeLensProvider {
    private readonly changed = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this.changed.event;
    private readonly watch = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vscode-dataform-tools.ctePreviewCodeLens')) {
            this.changed.fire();
        }
    });

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (isScratch(document) || extensionConfiguration(document.uri).get<boolean>('ctePreviewCodeLens') === false) {
            return [];
        }
        return cteChoices(document.getText(), isSqlx(document)).map(({ cte, choice }) => {
            const start = document.positionAt(cte.start);
            return new vscode.CodeLens(new vscode.Range(start, start), {
                title: '▶ Preview CTE',
                tooltip: `Run the query's WITH clause up to ${cte.name} and show its rows`,
                command: PREVIEW_CTE_COMMAND,
                arguments: [document.uri, choice],
            });
        });
    }

    dispose() {
        this.watch.dispose();
        this.changed.dispose();
    }
}

/** The light bulb in a CTE offers to preview it, also when the CodeLens is off */
export class CtePreviewCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
        const choice = isScratch(document) ? undefined : cteChoiceAt(document.getText(), document.offsetAt(range.start), isSqlx(document));
        if (!choice) {
            return [];
        }
        const action = new vscode.CodeAction(`Preview results of CTE ${choice.name}`, vscode.CodeActionKind.Empty);
        action.command = { title: action.title, command: PREVIEW_CTE_COMMAND, arguments: [document.uri, choice] };
        return [action];
    }
}

/**
 * Previews the rows of `choice` in the file at `uri`; without them, of the CTE the cursor is in. The file is
 * compiled first, and the CTE found by name in the compiled query.
 */
export async function previewCte(uri?: vscode.Uri, choice?: CteChoice) {
    const editor = vscode.window.activeTextEditor;
    const document = uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
    if (!document || isScratch(document)) {
        return;
    }
    if (!choice && editor?.document === document) {
        choice = cteChoiceAt(document.getText(), document.offsetAt(editor.selection.active), isSqlx(document));
    }
    if (!choice) {
        vscode.window.showInformationMessage('Put the cursor in a CTE of the query to preview its rows.');
        return;
    }
    const cte = { ...choice, limit: queryLimit };
    const dbt = dbtFileOf(document);
    const found = dbt ? await dbtPreviewFile(dbt, cte) : await previewDataformCte(document.uri.fsPath, cte);
    if (!found) {
        const variant = !dbt && incrementalCheckBox ? ' of the incremental variant' : '';
        const save = document.isDirty ? ' Save the file first: the compiled query is that of the saved file.' : '';
        vscode.window.showWarningMessage(`CTE ${choice.name} is not in the compiled query${variant}.${save}`);
    }
}

/** The CodeLens and light bulb, for the files `selector` matches */
export function ctePreviewProviders(selector: vscode.DocumentSelector): vscode.Disposable[] {
    const codeLenses = new CtePreviewCodeLensProvider();
    return [
        codeLenses,
        vscode.languages.registerCodeLensProvider(selector, codeLenses),
        vscode.languages.registerCodeActionsProvider(selector, new CtePreviewCodeActionProvider(), {
            providedCodeActionKinds: [vscode.CodeActionKind.Empty],
        }),
    ];
}

/** The command, and the CodeLens and light bulb in .sqlx files. Those of dbt files come with its editor features */
export function registerCtePreview(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(PREVIEW_CTE_COMMAND, previewCte),
        ...ctePreviewProviders({ language: 'sqlx' }),
    );
}
