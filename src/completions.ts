import * as vscode from 'vscode';
import { SchemaMetadata } from './types';

export const sourcesAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    // NOTE: Could this be made more reusable, i.e. a function that takes in the trigger and the language
    /*
    you might need to set up the file association to use the auto-completion
    sql should be added as a file association for sqlx
    this will enable both sufficient syntax highlighting and auto-completion
    */
    { language: 'sqlx', scheme: 'file' },
    {
        provideCompletionItems(document, position, token, context) {

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
            let sourceAutoCompletionPreference = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sourceAutoCompletionPreference');

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
        provideCompletionItems(document, position, token, context) {

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
        provideCompletionItems(document, position, token, context) {

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


export const schemaAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    { language: 'sqlx', scheme: 'file' },
    {
      async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        const completionItems = schemaAutoCompletions.map((item: SchemaMetadata) => {
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
        return completionItems;
      }
    }
);

