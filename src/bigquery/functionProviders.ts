import * as vscode from 'vscode';
import handWrittenFile from '../../snippets/bigquery.code-snippets.json';
import { BIGQUERY_FUNCTIONS, BigQueryFunction, functionHoverMarkdown, functionNamed, paramText, signatureLabel, snippetBody, withoutTabStops } from './functionCatalog';
import { activeParameter, callAt, functionNameAt, inSql } from './functionCall';

/*
 * The help the editor gives on a BigQuery function: the hover over its name, the signature help inside its
 * parentheses, and in a dbt file the completions that a .sqlx file has from the snippet files. The functions of the
 * catalog get all of it; the rest of the hand-written snippets keep their own description in the hover.
 */

interface HandWrittenSnippet {
    prefix: string | string[];
    body: string | string[];
    description?: string | string[];
}

const handWrittenSnippets = (handWrittenFile as Record<string, Record<string, HandWrittenSnippet>>)['.source.sql-bigquery'];

/** The hand-written snippets of functions, by name: `LOG(X)` and `LOG(X, Y)` are both LOG, and `LOG()` is preferred */
const handWrittenFunctions = new Map<string, { key: string; snippet: HandWrittenSnippet }>();
for (const [key, snippet] of Object.entries(handWrittenSnippets)) {
    // A function's key is its name and a bracket; `IN (value, ...)` is a keyword
    const name = /^([A-Za-z_][\w.]*)\(/.exec(key)?.[1].toUpperCase();
    if (name && (!handWrittenFunctions.has(name) || key === `${name}()`)) {
        handWrittenFunctions.set(name, { key, snippet });
    }
}

function handWrittenNamed(name: string) {
    const upper = name.toUpperCase();
    return handWrittenFunctions.get(upper) ?? (upper.startsWith('SAFE.') ? handWrittenFunctions.get(upper.slice('SAFE.'.length)) : undefined);
}

const joined = (text: string | string[] | undefined, separator: string) => (Array.isArray(text) ? text.join(separator) : text ?? '');

function handWrittenHover(snippet: HandWrittenSnippet): vscode.MarkdownString {
    const hover = new vscode.MarkdownString(joined(snippet.description, '\n\n'));
    hover.appendCodeblock(withoutTabStops(joined(snippet.body, '\n')), 'sql');
    return hover;
}

export class BigQueryFunctionHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const at = functionNameAt(document.lineAt(position.line).text, position.character);
        if (!at || !inSql(document.getText(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(position.line, at.start))))) {
            return undefined;
        }
        const range = new vscode.Range(position.line, at.start, position.line, at.end);
        const fn = functionNamed(at.name);
        if (fn) {
            return new vscode.Hover(new vscode.MarkdownString(functionHoverMarkdown(fn)), range);
        }
        const handWritten = handWrittenNamed(at.name);
        return handWritten ? new vscode.Hover(handWrittenHover(handWritten.snippet), range) : undefined;
    }
}

export class BigQuerySignatureHelpProvider implements vscode.SignatureHelpProvider {
    provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.SignatureHelp | undefined {
        const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        const call = inSql(before) ? callAt(before) : undefined;
        const fn = call && functionNamed(call.name);
        if (!call || !fn) {
            return undefined;
        }
        const actives = fn.signatures.map((signature) => activeParameter(signature.params, call.separators));
        const help = new vscode.SignatureHelp();
        help.signatures = fn.signatures.map((signature, index) => {
            const { label, params } = signatureLabel(fn, signature);
            const information = new vscode.SignatureInformation(label, new vscode.MarkdownString(fn.doc));
            information.parameters = signature.params.map((param, at) => {
                const text = paramText(param);
                return new vscode.ParameterInformation(params[at], text ? new vscode.MarkdownString(text) : undefined);
            });
            information.activeParameter = actives[index].index;
            return information;
        });
        // A signature picked with the arrows stays while it still fits; otherwise the first that fits what is typed
        const kept = context.activeSignatureHelp;
        const sameFunction = kept?.signatures[0]?.label === help.signatures[0].label;
        help.activeSignature = sameFunction && actives[kept!.activeSignature]?.fits ? kept!.activeSignature : Math.max(actives.findIndex((each) => each.fits), 0);
        help.activeParameter = actives[help.activeSignature].index;
        return help;
    }
}

function catalogItem(fn: BigQueryFunction): vscode.CompletionItem {
    const item = new vscode.CompletionItem({ label: fn.name, description: 'BigQuery' }, vscode.CompletionItemKind.Function);
    item.insertText = new vscode.SnippetString(snippetBody(fn));
    item.filterText = fn.name;
    item.detail = signatureLabel(fn, fn.signatures[0]).label;
    item.documentation = new vscode.MarkdownString(functionHoverMarkdown(fn));
    return item;
}

function handWrittenItem(key: string, snippet: HandWrittenSnippet): vscode.CompletionItem {
    const name = key.split('(')[0];
    const item = new vscode.CompletionItem({ label: name, description: 'BigQuery' }, vscode.CompletionItemKind.Function);
    item.insertText = new vscode.SnippetString(joined(snippet.body, '\n'));
    item.filterText = name;
    item.detail = withoutTabStops(joined(snippet.body, ' '));
    item.documentation = new vscode.MarkdownString(joined(snippet.description, '\n\n'));
    return item;
}

let completionItems: vscode.CompletionItem[] | undefined;

/** The function snippets of a .sqlx file, for a dbt file: no snippet file can be turned off by a setting */
export class BigQueryFunctionCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
        const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        if (!inSql(before)) {
            return undefined;
        }
        completionItems ??= [
            ...BIGQUERY_FUNCTIONS.map(catalogItem),
            ...[...handWrittenFunctions.entries()].filter(([name]) => !functionNamed(name)).map(([, { key, snippet }]) => handWrittenItem(key, snippet)),
        ];
        return completionItems;
    }
}

/**
 * The hover and the signature help of BigQuery functions in the files of a selector, and their completions when asked.
 * `wrap` is given each provider before it is registered, to change what it answers.
 */
export function registerBigQueryFunctionProviders(selector: vscode.DocumentSelector, withCompletions: boolean, wrap: <T extends object>(provider: T) => T = (provider) => provider): vscode.Disposable[] {
    const registered = [
        vscode.languages.registerHoverProvider(selector, wrap(new BigQueryFunctionHoverProvider())),
        // Asked again at a space too, so that the help follows a keyword argument such as CAST's AS or EXTRACT's FROM
        vscode.languages.registerSignatureHelpProvider(selector, wrap(new BigQuerySignatureHelpProvider()), { triggerCharacters: ['(', ','], retriggerCharacters: [' '] }),
    ];
    if (withCompletions) {
        registered.push(vscode.languages.registerCompletionItemProvider(selector, wrap(new BigQueryFunctionCompletionProvider())));
    }
    return registered;
}
