import * as vscode from 'vscode';
import { SchemaMetadata } from './types';

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
                { name: 'nonNull', description: 'This condition asserts that the specified columns are not null across all table rows.' },
                { name: 'rowConditions', description: 'This condition asserts that all table rows follow the custom logic you define.' },
                { name: 'uniqueKey', description: 'This condition asserts that, in a specified column, no table rows have the same value.' },
                { name: 'uniqueKeys', description: 'This condition asserts that, in the specified columns, no table rows have the same value.' }
            ] : inBigQueryBlock ? [
                { name: 'partitionBy', description: 'Expression for partitioning the table (e.g. "DATE(timestamp)").' },
                { name: 'clusterBy', description: 'A list of columns by which to cluster the table.' },
                { name: 'requirePartitionFilter', description: 'Whether queries must include a partition filter (true/false).' },
                { name: 'partitionExpirationDays', description: 'Number of days to retain partitions.' },
                { name: 'labels', description: 'A map of BigQuery labels to apply to the table.' },
                { name: 'updatePartitionFilter', description: 'Limits the partitions scanned in the target table during a MERGE operation for incremental tables.' },
                { name: 'iceberg', description: 'Iceberg table configuration.' }
            ] : [
                { name: 'type', description: 'The type of the dataset. "table", "view", "incremental", "inline", "declaration", "operations"' },
                { name: 'database', description: 'The database (Google Cloud project ID) to output the dataset to.' },
                { name: 'schema', description: 'The schema (BigQuery dataset) to output the dataset to.' },
                { name: 'name', description: 'The name of the dataset.' },
                { name: 'description', description: 'The description of the dataset.' },
                { name: 'columns', description: 'A map of column names to descriptions or configurations.' },
                { name: 'tags', description: 'A list of tags for the dataset.' },
                { name: 'dependencies', description: 'A list of dependencies for the dataset.' },
                { name: 'hasOutput', description: 'Whether an operations dataset generates an output.' },
                { name: 'assertions', description: 'Assertions to run after this dataset is created.' },
                { name: 'bigquery', description: 'BigQuery-specific configurations.' },
                { name: 'materialized', description: 'Whether a view is materialized.' },
                { name: 'onSchemaChange', description: 'Action to take when schema changes for incremental tables: "IGNORE", "FAIL", "EXTEND", "SYNCHRONIZE".' },
                { name: 'protected', description: 'Prevents the table from being rebuilt from scratch (e.g. true/false)' }
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

