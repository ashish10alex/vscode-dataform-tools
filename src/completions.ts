import * as vscode from 'vscode';
import { SchemaMetadata } from './types';
import { extensionConfiguration } from './project/settings';
import { TableChoice, columnCompletionItem, tableCompletionItems } from './columnCompletionItem';
import { ColumnTable, aliasAt, columnsAfterDots, cteNames, DIGITS, dottedNameBefore, inFromList, isDigitTrigger, mergeColumns } from './utils/columnPaths';
import { fileBackendHints, projects, ProjectState } from './project';
import { CompiledGraph, isMadeUpTarget, kindHasTable } from './shared/compiledGraph';
import { getMetadataForSqlxFileBlocks } from './sqlxFileParser';

/** The ref() of a target as the `sourceAutoCompletionPreference` setting writes it. A name two actions have needs its dataset */
export function refText(target: { schema: string, name: string }, preference: unknown, nameIsShared: boolean): string {
    if (preference === "${ref('dataset_name', 'table_name')}" || (preference !== "${ref({schema:'dataset_name', name:'table_name'})}" && nameIsShared)) {
        return `\${ref("${target.schema}", "${target.name}")}`;
    }
    if (preference === "${ref({schema:'dataset_name', name:'table_name'})}") {
        return `\${ref({schema: "${target.schema}", name: "${target.name}"})}`;
    }
    return `\${ref("${target.name}")}`;
}

/** The tables a .sqlx file can ref, as the list after a `$` offers them: no assertions, as nothing reads from one */
export function refChoices(graph: CompiledGraph | undefined, preference: unknown): TableChoice[] {
    const actions = Object.values(graph?.actions ?? {})
        .filter((action) => kindHasTable(action.kind) && action.kind !== 'assertion' && !isMadeUpTarget(action.target))
        .sort((a, b) => a.target.name.localeCompare(b.target.name) || a.target.schema.localeCompare(b.target.schema));
    const count = new Map<string, number>();
    actions.forEach((action) => count.set(action.target.name, (count.get(action.target.name) ?? 0) + 1));
    return actions.map((action) => ({
        label: `${action.target.schema}.${action.target.name}`,
        alsoMatches: [action.target.name],
        kind: action.kind,
        description: action.description,
        insertText: refText(action.target, preference, (count.get(action.target.name) ?? 0) > 1),
    }));
}

export const sourcesAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    /*
    you might need to set up the file association to use the auto-completion
    sql should be added as a file association for sqlx
    this will enable both sufficient syntax highlighting and auto-completion
    */
    { language: 'sqlx', scheme: 'file' },
    {
        provideCompletionItems(document, position) {
            // A `$` and what is typed after it, in the SQL: not a `${` already written
            const line = document.lineAt(position).text;
            const typed = /\$(\w*)$/.exec(line.substring(0, position.character));
            if (!typed || line[position.character] === '{') {
                return undefined;
            }
            const dollar = position.translate(0, -typed[0].length);
            if (!isInSqlBody(document, dollar)) {
                return undefined;
            }
            const found = projects.forFile(document.uri.fsPath, fileBackendHints(document.uri.fsPath));
            const graph = found.kind === 'project' ? (found.project as ProjectState).dataformBackend?.graph : undefined;
            const tables = refChoices(graph, extensionConfiguration().get('sourceAutoCompletionPreference'));
            return tables.length ? tableCompletionItems(tables, typed[1], new vscode.Range(dollar, position), typed[0]) : undefined;
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
        const choices = sqlxColumnTables('').flatMap((table) => table.fields.map((field) => ({ field, table: table.table })));
        schemaCompletionItems = mergeColumns(choices).map((column) => columnCompletionItem(column));
    }
    return schemaCompletionItems;
}

export const schemaAutoCompletionDisposable = () => vscode.languages.registerCompletionItemProvider(
    // Column names of the current file's dependencies only make sense in .sqlx files
    { language: 'sqlx' },
    {
      provideCompletionItems(document, position, _token, context) {
        if (!isInSqlBody(document, position)) {
            return undefined;
        }
        // After a dot: the columns of the table an alias names, or the fields of a STRUCT column
        const dotted = dottedNameBefore(document.lineAt(position).text.slice(0, position.character));
        if (dotted) {
            const choices = columnsAfterDots(dotted.qualifiers, sqlxColumnTables(document.getText()));
            if (choices) {
                const range = new vscode.Range(position.translate(0, -dotted.word.length), position);
                return mergeColumns(choices).map((column) => columnCompletionItem(column, range));
            }
            // A dot that leads to no column opens no list
            if (context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter) {
                return undefined;
            }
        }
        // Right after FROM or JOIN a table goes, not a column: the query's CTEs, beside the `$` list of refs
        const word = /\w*$/.exec(document.lineAt(position).text.slice(0, position.character))?.[0] ?? '';
        const start = position.translate(0, -word.length);
        if (start.character > 0 && document.lineAt(position).text[start.character - 1] === '$') {
            return undefined;
        }
        if (inFromList(document.getText(new vscode.Range(new vscode.Position(0, 0), start)))) {
            const ctes = cteNames(document.getText()).map((name) => ({ label: name, kind: 'cte', insertText: name }));
            return ctes.length ? tableCompletionItems(ctes, word, new vscode.Range(start, position), word) : undefined;
        }
        // A digit opens the list only where a table goes
        if (isDigitTrigger(context)) {
            return undefined;
        }
        return getSchemaCompletionItems();
      }
    },
    '.', ...DIGITS
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
                // A SQL comment, which in the backtick string of a `${ ... }` also ends where the string does
                const lineEnd = sql.indexOf('\n', i);
                const stringEnd = template ? sql.indexOf('`', i) : -1;
                const end = [lineEnd, stringEnd].filter((at) => at !== -1).sort((a, b) => a - b)[0];
                i = end === undefined ? sql.length : end - 1;
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
