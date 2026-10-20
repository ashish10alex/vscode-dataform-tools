import * as vscode from 'vscode';
import { SchemaMetadata } from './types';
import { extensionConfiguration } from './project/settings';
import { columnCompletionItem } from './columnCompletionItem';
import { ColumnTable, aliasAt, columnsAfterDots, dottedNameBefore } from './utils/columnPaths';

export const sourcesAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    // NOTE: Could this be made more reusable, i.e. a function that takes in the trigger and the language
    /*
    you might need to set up the file association to use the auto-completion
    sql should be added as a file association for sqlx
    this will enable both sufficient syntax highlighting and auto-completion
    */
    { language: 'sqlx', scheme: 'file' },
    {
        provideCompletionItems(document, position) {

            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            if (!linePrefix.endsWith('$')) {
                return undefined;
            }
            let sourceCompletionItem = (text: any) => {
                let item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Field);
                item.range = new vscode.Range(position, position);
                return item;
            };
            if (declarationsAndTargets.length === 0) {
                return undefined;
            }
            let sourceAutoCompletionPreference = extensionConfiguration().get('sourceAutoCompletionPreference');

            let sourceCompletionItems: vscode.CompletionItem[] = [];

            if (sourceAutoCompletionPreference === "${ref('table_name')}"){
                declarationsAndTargets.forEach((source: string) => {
                    source = `{ref("${source}")}`;
                    sourceCompletionItems.push(sourceCompletionItem(source));
                });
            } else if (sourceAutoCompletionPreference === "${ref('dataset_name', 'table_name')}") {
                declarationsAndTargets.forEach((source: string) => {
                    let [database, table] = source.split('.');
                    source = `{ref("${database}", "${table}")}`;
                    sourceCompletionItems.push(sourceCompletionItem(source));
                });
            }
            else {
                declarationsAndTargets.forEach((source: string) => {
                    let [database, table] = source.split('.');
                    source = `{ref({schema: "${database}", name: "${table}"})}`;
                    sourceCompletionItems.push(sourceCompletionItem(source));
                });
            }
            return sourceCompletionItems;
        }
    },
    '$' // trigger
);

export const dependenciesAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    // NOTE: Could this be made more reusable, i.e. a function that takes in the trigger and the language
    { language: 'sqlx', scheme: 'file' },
    {
        provideCompletionItems(document, position) {

            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            if (!(linePrefix.includes('dependencies') && ( linePrefix.includes('"') || linePrefix.includes("'")))){
                return undefined;
            }
            let sourceCompletionItem = (text: any) => {
                let item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Field);
                item.range = new vscode.Range(position, position);
                return item;
            };
            if (declarationsAndTargets.length === 0) {
                return undefined;
            }
            let sourceCompletionItems: vscode.CompletionItem[] = [];
            declarationsAndTargets.forEach((source: string) => {
                source = `${source}`;
                sourceCompletionItems.push(sourceCompletionItem(source));
            });
            return sourceCompletionItems;
        },
    },
    ...["'", '"'],
);

export const tagsAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    // NOTE: Could this be made more reusable, i.e. a function that takes in the trigger and the language
    { language: 'sqlx', scheme: 'file' },
    {
        provideCompletionItems(document, position) {

            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            if (!(linePrefix.includes('tags') && ( linePrefix.includes('"') || linePrefix.includes("'")))){
                return undefined;
            }
            let sourceCompletionItem = (text: any) => {
                let item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Field);
                item.range = new vscode.Range(position, position);
                return item;
            };
            if (dataformTags.length === 0) {
                return undefined;
            }
            let sourceCompletionItems: vscode.CompletionItem[] = [];
            dataformTags.forEach((source: string) => {
                source = `${source}`;
                sourceCompletionItems.push(sourceCompletionItem(source));
            });
            return sourceCompletionItems;
        },
    },
    ...["'", '"'],
);


/** The tables the current file's dependencies build, with their columns and the names the file qualifies them with */
function sqlxColumnTables(text: string): ColumnTable[] {
    const tables = new Map<string, ColumnTable>();
    for (const column of schemaAutoCompletions) {
        const id = column.metadata.fullTableId;
        let table = tables.get(id);
        if (!table) {
            const name = id.split('.').pop() ?? id;
            table = { table: name, names: [name], fields: [] };
            tables.set(id, table);
        }
        table.fields.push(column.metadata.field ?? { name: column.name, type: column.metadata.type, description: column.metadata.description });
    }
    for (const { name, alias } of refAliasesIn(text)) {
        const wanted = name.toLowerCase();
        [...tables.values()].find((table) => table.table.toLowerCase() === wanted)?.names.push(alias);
    }
    return [...tables.values()];
}

/** The aliases a .sqlx file gives the tables it refs: `${ref("orders")} o`, `${ref("shop", "orders")} AS o` */
export function refAliasesIn(text: string): { name: string, alias: string }[] {
    const found: { name: string, alias: string }[] = [];
    for (const match of text.matchAll(/\$\{\s*ref\s*\(([^)]*)\)\s*\}/g)) {
        const args = match[1];
        const name = /name\s*:\s*["'`]([^"'`]+)/.exec(args)?.[1] ?? [...args.matchAll(/["'`]([^"'`]+)["'`]/g)].pop()?.[1];
        const end = match.index + match[0].length;
        const alias = aliasAt(text.slice(end, end + 100));
        if (name && alias) {
            found.push({ name, alias });
        }
    }
    return found;
}

// Rebuilt only when the schemas change (a save or editor switch), not on every keystroke that asks for completions
let schemaCompletionSource: SchemaMetadata[] | undefined;
let schemaCompletionItems: vscode.CompletionItem[] = [];

function getSchemaCompletionItems(): vscode.CompletionItem[] {
    if (schemaCompletionSource !== schemaAutoCompletions) {
        schemaCompletionSource = schemaAutoCompletions;
        schemaCompletionItems = sqlxColumnTables('').flatMap((table) => table.fields.map((field) => columnCompletionItem({ field, table: table.table })));
    }
    return schemaCompletionItems;
}

export const schemaAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    // Column names of the current file's dependencies only make sense in .sqlx files
    { language: 'sqlx' },
    {
      provideCompletionItems(document, position, _token, context) {
        // After a dot: the columns of the table an alias names, or the fields of a STRUCT column
        const dotted = dottedNameBefore(document.lineAt(position).text.slice(0, position.character));
        if (dotted) {
            const choices = columnsAfterDots(dotted.qualifiers, sqlxColumnTables(document.getText()));
            if (choices) {
                const range = new vscode.Range(position.translate(0, -dotted.word.length), position);
                return choices.map((choice) => columnCompletionItem(choice, range));
            }
            // A dot that leads to no column, as in the JavaScript of a js block, opens no list
            if (context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter) {
                return undefined;
            }
        }
        return getSchemaCompletionItems();
      }
    },
    '.'
);
