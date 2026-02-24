import * as vscode from 'vscode';
import { SchemaMetadata } from './types';
import { configBlockHoverOptions } from './constants';

export const configBlockAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    { language: 'sqlx', scheme: 'file' },
    {
        provideCompletionItems(document, position) {
            // Optimized inline check:
            // 1. Only scan up to the cursor's line
            // 2. Count braces only when inside a 'config {' block
            // 3. Keep track of 'bigquery {' scope
            // 4. Exit early if the block was closed before reaching the cursor
            let inConfigBlock = false;
            let inBigQueryBlock = false;
            let inAssertionBlock = false;
            let configBraceDepth = 0;
            let bigQueryBraceDepth = 0;
            let assertionBraceDepth = 0;

            // Hard limit: only scan up to 50 lines to prevent O(N) performance on massive files.
            // Config blocks are almost exclusively at the very top of .sqlx files.
            const maxLinesToScan = Math.min(position.line, 50);

            for (let i = 0; i <= maxLinesToScan; i++) {
                const line = document.lineAt(i).text;
                const trimmed = line.trim();
                
                // Skip empty lines early
                if (trimmed.length === 0) { continue; }

                if (!inConfigBlock && trimmed.startsWith('config {')) {
                    inConfigBlock = true;
                    // Pre-count opening brace from 'config {'
                    configBraceDepth = 1;

                    // If 'config {' and '}' are on the same line (edge case)
                    if (trimmed.endsWith('}')) {
                        inConfigBlock = false;
                        configBraceDepth = 0;
                    }
                } else if (inConfigBlock) {
                    // Check for nested bigquery block
                    if (!inBigQueryBlock && trimmed.match(/bigquery\s*:\s*\{/)) {
                        inBigQueryBlock = true;
                        bigQueryBraceDepth = 1;
                        if (trimmed.endsWith('}')) {
                            inBigQueryBlock = false;
                            bigQueryBraceDepth = 0;
                        }
                        // Skip counting the first '{' of bigquery again
                        continue;
                    }

                    // Check for nested assertions block
                    if (!inAssertionBlock && trimmed.match(/assertions\s*:\s*\{/)) {
                        inAssertionBlock = true;
                        assertionBraceDepth = 1;
                        if (trimmed.endsWith('}')) {
                            inAssertionBlock = false;
                            assertionBraceDepth = 0;
                        }
                        continue;
                    }

                    let openBraces = 0;
                    let closedBraces = 0;
                    // Count braces efficiently
                    for (let j = 0; j < line.length; j++) {
                        if (line[j] === '{') { openBraces++; }
                        else if (line[j] === '}') { closedBraces++; }
                    }
                    
                    if (inBigQueryBlock) {
                        bigQueryBraceDepth += openBraces - closedBraces;
                        if (bigQueryBraceDepth <= 0) {
                            inBigQueryBlock = false;
                        }
                    } else if (inAssertionBlock) {
                        assertionBraceDepth += openBraces - closedBraces;
                        if (assertionBraceDepth <= 0) {
                            inAssertionBlock = false;
                        }
                    } else {
                        configBraceDepth += openBraces - closedBraces;
                        if (configBraceDepth <= 0) {
                            inConfigBlock = false;
                            // config block ended before our position line
                        }
                    }
                }
            }
                                  
            if (!inConfigBlock) {
                return undefined;
            }

            const linePrefix = document.lineAt(position).text.substring(0, position.character);

            // Check if we are typing a value for onSchemaChange
            if (linePrefix.match(/onSchemaChange\s*:\s*["']?$/)) {
                const actions = [
                    { label: 'IGNORE', detail: 'Ignores added columns and shows an error for missing columns. Default.' },
                    { label: 'FAIL', detail: 'Stops the action if any schema change is detected.' },
                    { label: 'EXTEND', detail: 'Adds new columns, adds NULL for previous records. Fails if columns missing.' },
                    { label: 'SYNCHRONIZE', detail: 'Adds new columns, adds NULL for previous records. Removes missing columns. (Cannot be undone)' }
                ];
                return actions.map(action => {
                    const item = new vscode.CompletionItem(action.label, vscode.CompletionItemKind.Value);
                    item.detail = action.detail;
                    item.insertText = linePrefix.endsWith('"') || linePrefix.endsWith("'") ? action.label : `"${action.label}"`;
                    return item;
                });
            }

            // Check if we are typing a value for type
            if (linePrefix.match(/type\s*:\s*["']?$/)) {
                const types = [
                    { label: "table", detail: "A standard table." },
                    { label: "view", detail: "A standard view." },
                    { label: "incremental", detail: "An incremental table." },
                    { label: "operations", detail: "A custom SQL operation." }
                ];
                return types.map(t => {
                    const item = new vscode.CompletionItem(t.label, vscode.CompletionItemKind.Value);
                    item.detail = t.detail;
                    item.insertText = linePrefix.endsWith('"') || linePrefix.endsWith("'") ? t.label : `"${t.label}"`;
                    return item;
                });
            }

            const configOptions = inAssertionBlock ? [
                { name: 'nonNull', description: configBlockHoverOptions['nonNull'] },
                { name: 'rowConditions', description: configBlockHoverOptions['rowConditions'] },
                { name: 'uniqueKey', description: configBlockHoverOptions['uniqueKey'] },
                { name: 'uniqueKeys', description: configBlockHoverOptions['uniqueKeys'] }
            ] : inBigQueryBlock ? [
                { name: 'partitionBy', description: configBlockHoverOptions['partitionBy'] },
                { name: 'clusterBy', description: configBlockHoverOptions['clusterBy'] },
                { name: 'requirePartitionFilter', description: configBlockHoverOptions['requirePartitionFilter'] },
                { name: 'partitionExpirationDays', description: configBlockHoverOptions['partitionExpirationDays'] },
                { name: 'labels', description: configBlockHoverOptions['labels'] },
                { name: 'updatePartitionFilter', description: configBlockHoverOptions['updatePartitionFilter'] },
                { name: 'iceberg', description: configBlockHoverOptions['iceberg'] }
            ] : [
                { name: 'type', description: configBlockHoverOptions['type'] },
                { name: 'database', description: configBlockHoverOptions['database'] },
                { name: 'schema', description: configBlockHoverOptions['schema'] },
                { name: 'name', description: configBlockHoverOptions['name'] },
                { name: 'description', description: configBlockHoverOptions['description'] },
                { name: 'columns', description: configBlockHoverOptions['columns'] },
                { name: 'tags', description: configBlockHoverOptions['tags'] },
                { name: 'dependencies', description: configBlockHoverOptions['dependencies'] },
                { name: 'hasOutput', description: configBlockHoverOptions['hasOutput'] },
                { name: 'assertions', description: configBlockHoverOptions['assertions'] },
                { name: 'bigquery', description: configBlockHoverOptions['bigquery'] },
                { name: 'materialized', description: configBlockHoverOptions['materialized'] },
                { name: 'onSchemaChange', description: configBlockHoverOptions['onSchemaChange'] },
                { name: 'protected', description: configBlockHoverOptions['protected'] }
            ];

            const completionItems = configOptions.map(option => {
                const item = new vscode.CompletionItem(option.name, vscode.CompletionItemKind.Property);
                item.detail = option.description; // Assign description to detail so it shows in the list immediately
                item.documentation = new vscode.MarkdownString(option.description);
                item.insertText = new vscode.SnippetString(`${option.name}: $1`); // Add colon and move cursor inside
                return item;
            });

            return completionItems;
        }
    },
    ':', '"', "'"
);

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


export const schemaAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    "*",
    {
      async provideCompletionItems() {
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

