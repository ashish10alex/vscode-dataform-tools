import * as vscode from "vscode";
import { Column, Target } from "./types";
import { fetchTableMetadata } from "./hoverProvider";
import { applyColumnDescriptions, flattenSchemaRows } from "./utils/schemaTree";
import { getCurrentFileMetadata } from "./utils";

interface ModelQuickPickItem extends vscode.QuickPickItem {
    target: Target;
    columns?: Column[];
}

interface ColumnQuickPickItem extends vscode.QuickPickItem {
    /** The dotted path inserted at the cursor when the item is picked. */
    insertText: string;
}

const isCompleteTarget = (target?: Target): target is Target =>
    Boolean(target?.database && target?.schema && target?.name);

const fullTableId = (target: Target) => `${target.database}.${target.schema}.${target.name}`;

/**
 * Descriptions declared in a SQLX config block are not in BigQuery until the table is rebuilt,
 * so pull them off the compiled action when we have one for this target.
 */
function columnsForTarget(target: Target): Column[] | undefined {
    const nodes = global.TARGET_NAME_MAP?.get(target.name) ?? [];
    const match = nodes.find((node: any) => node?.target && fullTableId(node.target) === fullTableId(target));
    return (match as any)?.actionDescriptor?.columns;
}

/**
 * Offers the model the active file defines plus every model it refs. `dependencyTargets` comes
 * from the compiler, so it is already resolved and free of CTEs.
 */
async function pickModel(): Promise<ModelQuickPickItem | undefined> {
    const curFileMeta = await getCurrentFileMetadata(false);
    const table = curFileMeta?.fileMetadata?.tables?.[0];
    if (!isCompleteTarget(table?.target)) {
        vscode.window.showErrorMessage(
            "Could not work out which models this file uses. Open a Dataform model, or run this from a table hover."
        );
        return undefined;
    }

    const thisFile: ModelQuickPickItem = {
        label: `$(file-code) ${table.target.name}`,
        description: `${table.target.database}.${table.target.schema}`,
        target: table.target,
        columns: table.actionDescriptor?.columns,
    };

    const seen = new Set([fullTableId(table.target)]);
    const referenced: ModelQuickPickItem[] = [];
    for (const dependency of table.dependencyTargets ?? []) {
        if (!isCompleteTarget(dependency) || seen.has(fullTableId(dependency))) {
            continue;
        }
        seen.add(fullTableId(dependency));
        referenced.push({
            label: `$(link) ${dependency.name}`,
            description: `${dependency.database}.${dependency.schema}`,
            target: dependency,
            columns: columnsForTarget(dependency),
        });
    }

    // Nothing to choose between.
    if (referenced.length === 0) {
        return thisFile;
    }

    referenced.sort((a, b) => a.target.name.localeCompare(b.target.name));
    const items: vscode.QuickPickItem[] = [
        { label: "This file", kind: vscode.QuickPickItemKind.Separator },
        thisFile,
        { label: "Referenced models", kind: vscode.QuickPickItemKind.Separator },
        ...referenced,
    ];

    const picked = await vscode.window.showQuickPick(items as ModelQuickPickItem[], {
        title: "Search columns",
        placeHolder: `Select a model (${referenced.length} referenced by this file)`,
        matchOnDescription: true,
    });
    return picked;
}

export async function searchTableColumns(target?: Target) {
    // The hover passes the table it is describing, which skips the model picker.
    const model: ModelQuickPickItem | undefined = isCompleteTarget(target)
        ? { label: target.name, target, columns: columnsForTarget(target) }
        : await pickModel();
    if (!model) {
        return;
    }

    const { database, schema, name } = model.target;
    const tableId = fullTableId(model.target);

    let metadata: any;
    try {
        metadata = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Fetching schema for ${name}` },
            () => fetchTableMetadata(database, schema, name)
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Could not fetch schema for ${tableId}: ${error?.message ?? error}`);
        return;
    }

    const fields = metadata?.schema?.fields;
    if (!fields?.length) {
        vscode.window.showWarningMessage(`No schema available for ${tableId}`);
        return;
    }

    const describedFields = model.columns?.length ? applyColumnDescriptions(fields, model.columns) : fields;
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
        title: tableId,
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
