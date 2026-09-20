import * as vscode from "vscode";
import { Target } from "./types";
import { fetchTableMetadata } from "./hoverProvider";
import { applyColumnDescriptions, flattenSchemaRows } from "./utils/schemaTree";
import { getCurrentFileMetadata } from "./utils";

interface ColumnQuickPickItem extends vscode.QuickPickItem {
    /** The dotted path inserted at the cursor when the item is picked. */
    insertText: string;
}

const isCompleteTarget = (target?: Target): target is Target =>
    Boolean(target?.database && target?.schema && target?.name);

/**
 * The hover passes the table it is describing. Invoked from the command palette there is no
 * target, so fall back to the model the active file defines.
 */
async function resolveTarget(target?: Target): Promise<{ target?: Target; columns?: any[] }> {
    if (isCompleteTarget(target)) {
        return { target };
    }
    const curFileMeta = await getCurrentFileMetadata(false);
    const table = curFileMeta?.fileMetadata?.tables?.[0];
    return { target: table?.target, columns: (table as any)?.actionDescriptor?.columns };
}

export async function searchTableColumns(target?: Target) {
    const resolved = await resolveTarget(target);
    if (!isCompleteTarget(resolved.target)) {
        vscode.window.showErrorMessage(
            "Could not work out which table to search. Open a Dataform model, or run this from a table hover."
        );
        return;
    }

    const { database, schema, name } = resolved.target;
    const fullTableId = `${database}.${schema}.${name}`;

    let metadata: any;
    try {
        metadata = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Fetching schema for ${name}` },
            () => fetchTableMetadata(database, schema, name)
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Could not fetch schema for ${fullTableId}: ${error?.message ?? error}`);
        return;
    }

    const fields = metadata?.schema?.fields;
    if (!fields?.length) {
        vscode.window.showWarningMessage(`No schema available for ${fullTableId}`);
        return;
    }

    // Same fallback as the hover: descriptions declared in SQLX are not in BigQuery until the
    // table is rebuilt.
    const describedFields = resolved.columns?.length ? applyColumnDescriptions(fields, resolved.columns) : fields;
    const { rows } = flattenSchemaRows(describedFields);

    const items: ColumnQuickPickItem[] = rows.map((row) => {
        const dottedPath = row.path.join(".");
        const icon = row.type.startsWith("RECORD") ? "$(symbol-structure)" : "$(symbol-field)";
        return {
            label: `${icon} ${dottedPath}`,
            description: row.type,
            detail: row.description || undefined,
            insertText: dottedPath,
        };
    });

    const picked = await vscode.window.showQuickPick(items, {
        title: fullTableId,
        placeHolder: `Search ${items.length} columns by name, type or description`,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) {
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
        await editor.edit((editBuilder) => editBuilder.insert(editor.selection.active, picked.insertText));
        return;
    }

    // No editor to insert into, so leave the column somewhere the user can still use it.
    await vscode.env.clipboard.writeText(picked.insertText);
    vscode.window.showInformationMessage(`Copied ${picked.insertText} to the clipboard`);
}
