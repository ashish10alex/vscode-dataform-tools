import * as vscode from 'vscode';
import { SchemaMetadata } from './types';
import { extensionConfiguration } from './project/settings';
import { getMetadataForSqlxFileBlocks } from './sqlxFileParser';

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


// Rebuilt only when the schemas change (a save or editor switch), not on every keystroke that asks for completions
let schemaCompletionSource: SchemaMetadata[] | undefined;
let schemaCompletionItems: vscode.CompletionItem[] = [];

function getSchemaCompletionItems(): vscode.CompletionItem[] {
    if (schemaCompletionSource !== schemaAutoCompletions) {
        schemaCompletionSource = schemaAutoCompletions;
        schemaCompletionItems = schemaAutoCompletions.map((item: SchemaMetadata) => {
            const completionItem = new vscode.CompletionItem(`${item.name}`);
            completionItem.kind = vscode.CompletionItemKind.Variable;
            completionItem.detail = `${item.metadata.fullTableId}`;
            completionItem.sortText = '0'; // put it ahead of other completion objects
            const markdownString = new vscode.MarkdownString(`[ ${item.metadata.type} ] \n\n ${item.metadata.description}`);
            markdownString.isTrusted = true;
            markdownString.supportHtml = true;
            completionItem.documentation = markdownString;
            return completionItem;
        });
    }
    return schemaCompletionItems;
}

export const schemaAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    // Column names of the current file's dependencies only make sense in .sqlx files
    { language: 'sqlx' },
    {
      provideCompletionItems(document, position) {
        if (!isInSqlBody(document, position)) {
            return undefined;
        }
        return getSchemaCompletionItems();
      }
    }
);

/** Whether the position is in the SQL of a .sqlx file: not in its config, js, pre_operations or post_operations block, nor in the JavaScript of a `${ ... }` */
function isInSqlBody(document: vscode.TextDocument, position: vscode.Position): boolean {
    const blocks = getMetadataForSqlxFileBlocks(document);
    const blockRanges = [blocks.configBlock, blocks.jsBlock, ...blocks.preOpsBlock.preOpsList, ...blocks.postOpsBlock.postOpsList]
        .filter(block => block.exists);
    // The block lines are 1-based
    const inBlock = (line: number) => blockRanges.some(block => line + 1 >= block.startLine && line + 1 <= block.endLine);
    if (inBlock(position.line)) {
        return false;
    }
    // A `${ ... }` can span lines, such as a `${when(incremental(), ...)}` around a WHERE clause, so read the SQL from the top
    let sql = '';
    for (let line = 0; line < position.line; line++) {
        if (!inBlock(line)) {
            sql += document.lineAt(line).text + '\n';
        }
    }
    sql += document.lineAt(position).text.substring(0, position.character);
    return !endsInTemplateCode(sql);
}

/**
 * Whether the end of the SQL is in the JavaScript of a `${ ... }`, e.g. `FROM ${ref("`.
 * The SQL of a backtick string in one, such as the WHERE clause in `${when(incremental(), ...)}`, is not.
 */
function endsInTemplateCode(sql: string): boolean {
    // Each open `${`: its depth of `{` and whether a backtick string in it is open
    const templates: { depth: number, inString: boolean }[] = [];
    for (let i = 0; i < sql.length; i++) {
        const template = templates[templates.length - 1];
        const ch = sql[i];
        if (!template || template.inString) {
            if (ch === '$' && sql[i + 1] === '{') {
                templates.push({ depth: 0, inString: false });
                i++;
            } else if (template && ch === '`') {
                template.inString = false;
            } else if (ch === '-' && sql[i + 1] === '-') {
                // A SQL comment
                const end = sql.indexOf('\n', i);
                i = end === -1 ? sql.length : end;
            }
        } else if (ch === '`') {
            template.inString = true;
        } else if (ch === '{') {
            template.depth++;
        } else if (ch === '}') {
            if (template.depth === 0) {
                templates.pop();
            } else {
                template.depth--;
            }
        }
    }
    const template = templates[templates.length - 1];
    return template !== undefined && !template.inString;
}
