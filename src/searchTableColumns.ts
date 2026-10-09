import * as vscode from "vscode";
import { compiledIndices } from './project';
import { Column, ColumnMetadata, Target } from "./types";
import { dbtColumnSource } from "./project/dbtEditor";
import { fetchTableMetadata, resolveTableReferenceAtPosition } from "./hoverProvider";
import { applyColumnDescriptions, flattenSchemaRows } from "./utils/schemaTree";
import { getCurrentFileMetadata } from "./utils";

/** A table whose columns can be searched, with the descriptions the Project's code gives them */
export interface SearchedModel {
    target: Target;
    columns?: Column[];
}

/** Where the command finds the tables of the active file and their schemas: one for each Backend */
export interface ColumnSource {
    /** The table the hover named, which skips the pick of a model */
    ofTarget(target: Target): SearchedModel;
    /** The table the cursor is on, by the same resolution the hover uses */
    underCursor(): Promise<SearchedModel | undefined>;
    /** The table the active file builds, and those it reads. Undefined when the file is no model */
    ofFile(): Promise<{ thisFile?: SearchedModel; referenced: SearchedModel[] } | undefined>;
    /** The table's schema as BigQuery has it. Rejects with why when there is none to read */
    fields(model: SearchedModel): Promise<ColumnMetadata[] | undefined>;
}

interface ModelQuickPickItem extends vscode.QuickPickItem {
    model: SearchedModel;
}

interface ColumnQuickPickItem extends vscode.QuickPickItem {
    /** The dotted path copied to the clipboard when the item is picked. */
    copyText: string;
}

const isCompleteTarget = (target?: Target): target is Target =>
    Boolean(target?.database && target?.schema && target?.name);

const fullTableId = (target: Target) => `${target.database}.${target.schema}.${target.name}`;

/**
 * Descriptions declared in a SQLX config block are not in BigQuery until the table is rebuilt,
 * so pull them off the compiled action when we have one for this target.
 */
function columnsForTarget(target: Target): Column[] | undefined {
    const nodes = compiledIndices().targetNameMap.get(target.name) ?? [];
    const match = nodes.find((node: any) => node?.target && fullTableId(node.target) === fullTableId(target));
    return (match as any)?.actionDescriptor?.columns;
}

/** Dataform's: the models come from the compile, so they are already resolved and free of CTEs */
const dataformSource: ColumnSource = {
    ofTarget: (target) => ({ target, columns: columnsForTarget(target) }),
    underCursor: async () => {
        const editor = vscode.window.activeTextEditor;
        const reference = editor && await resolveTableReferenceAtPosition(editor.document, editor.selection.active);
        return reference && { target: reference.target, columns: reference.columns?.length ? reference.columns : columnsForTarget(reference.target) };
    },
    ofFile: async () => {
        const curFileMeta = await getCurrentFileMetadata(false);
        const table = curFileMeta?.fileMetadata?.tables?.[0];
        if (!isCompleteTarget(table?.target)) {
            return undefined;
        }
        return {
            thisFile: { target: table.target, columns: table.actionDescriptor?.columns },
            referenced: (table.dependencyTargets ?? []).filter(isCompleteTarget).map((target) => ({ target, columns: columnsForTarget(target) })),
        };
    },
    fields: async ({ target }) => (await fetchTableMetadata(target.database, target.schema, target.name))?.schema?.fields,
};

/** Offers the model the active file defines plus every model it reads */
async function pickModel(source: ColumnSource): Promise<SearchedModel | undefined> {
    const models = await source.ofFile();
    if (!models || (!models.thisFile && models.referenced.length === 0)) {
        vscode.window.showErrorMessage(
            "Could not work out which models this file uses. Open a model, or run this from a model hover."
        );
        return undefined;
    }
    const item = (icon: string, model: SearchedModel): ModelQuickPickItem => ({
        label: `$(${icon}) ${model.target.name}`,
        description: `${model.target.database}.${model.target.schema}`,
        model,
    });

    const seen = new Set(models.thisFile ? [fullTableId(models.thisFile.target)] : []);
    const referenced: ModelQuickPickItem[] = [];
    for (const dependency of models.referenced) {
        if (seen.has(fullTableId(dependency.target))) {
            continue;
        }
        seen.add(fullTableId(dependency.target));
        referenced.push(item('link', dependency));
    }

    // Nothing to choose between.
    if (models.thisFile && referenced.length === 0) {
        return models.thisFile;
    }

    referenced.sort((a, b) => a.model.target.name.localeCompare(b.model.target.name));
    const items: vscode.QuickPickItem[] = [
        ...(models.thisFile ? [{ label: "This file", kind: vscode.QuickPickItemKind.Separator }, item('file-code', models.thisFile)] : []),
        { label: "Referenced models", kind: vscode.QuickPickItemKind.Separator },
        ...referenced,
    ];

    const picked = await vscode.window.showQuickPick(items as ModelQuickPickItem[], {
        title: "Search columns",
        placeHolder: `Select a model (${referenced.length} referenced by this file)`,
        matchOnDescription: true,
    });
    return picked?.model;
}

export async function searchTableColumns(target?: Target) {
    const editor = vscode.window.activeTextEditor;
    // A file of a dbt Project is asked about as dbt's, any other as Dataform's
    const source = (editor && dbtColumnSource(editor.document, editor.selection.active)) ?? dataformSource;
    // The hover passes the table it is describing, which skips the model picker. From the editor
    // context menu there is a cursor: a table under it wins over the picker.
    const model = isCompleteTarget(target)
        ? source.ofTarget(target)
        : (await source.underCursor()) ?? (await pickModel(source));
    if (!model) {
        return;
    }

    const { name } = model.target;
    const tableId = fullTableId(model.target);

    let fields: ColumnMetadata[] | undefined;
    try {
        fields = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Fetching schema for ${name}` },
            () => source.fields(model)
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Could not fetch schema for ${tableId}: ${error?.message ?? error}`);
        return;
    }

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
            copyText: dottedPath,
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

    await vscode.env.clipboard.writeText(picked.copyText);
    // Status bar rather than a notification: this is a command you run repeatedly, and stacked
    // toasts get in the way.
    vscode.window.setStatusBarMessage(`Copied ${picked.copyText} to the clipboard`, 3000);
}
