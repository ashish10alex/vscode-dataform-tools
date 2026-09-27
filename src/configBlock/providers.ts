import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readDataformCoreVersion } from '../utils/dataformHelpers';
import { ConfigLocation, ParsedConfigBlock, getLocationAt, parseConfigBlock } from './parser';
import { KeyInfo, SqlxActionType, docsUrl, typesAllowingKey } from './schema';
import { ConfigIssue, getActionType, keySetFor, validateConfigBlock } from './validator';

export const CONFIG_DIAGNOSTIC_SOURCE = 'Dataform config';
const DIAGNOSTICS_SETTING = 'configBlockDiagnostics';
const SQLX_SELECTOR: vscode.DocumentSelector = { language: 'sqlx' };

/** Parse results keyed by document, reused until the document version changes. */
const parseCache = new WeakMap<vscode.TextDocument, { version: number; parsed: ParsedConfigBlock | undefined }>();

function parseDocument(document: vscode.TextDocument): ParsedConfigBlock | undefined {
    const cached = parseCache.get(document);
    if (cached && cached.version === document.version) {
        return cached.parsed;
    }
    const parsed = parseConfigBlock(document.getText());
    parseCache.set(document, { version: document.version, parsed });
    return parsed;
}

function locationAt(document: vscode.TextDocument, position: vscode.Position): { parsed: ParsedConfigBlock; location: ConfigLocation } | undefined {
    const parsed = parseDocument(document);
    if (!parsed) {
        return undefined;
    }
    const location = getLocationAt(parsed, document.offsetAt(position));
    return location ? { parsed, location } : undefined;
}

/** True when `position` is on a property key inside the config block. */
export function isOnConfigKey(document: vscode.TextDocument, position: vscode.Position): boolean {
    return !!locationAt(document, position)?.location.onKey;
}

// ---------------------------------------------------------------------------------------------------
// Dataform version

/** Project roots mapped to whether they use Dataform core 2.x. */
const legacyProjectCache = new Map<string, Promise<boolean>>();

function findProjectRoot(filePath: string): string | undefined {
    let dir = path.dirname(filePath);
    while (true) {
        if (fs.existsSync(path.join(dir, 'workflow_settings.yaml')) || fs.existsSync(path.join(dir, 'dataform.json'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

/** Dataform 2.x accepts a different set of config keys than the bundled 3.x schema. */
function isDataformV2Project(document: vscode.TextDocument): Promise<boolean> {
    const root = document.uri.scheme === 'file' ? findProjectRoot(document.uri.fsPath) : undefined;
    if (!root) {
        return Promise.resolve(false);
    }
    let result = legacyProjectCache.get(root);
    if (!result) {
        result = (async () => {
            const version = await readDataformCoreVersion(root).catch(() => undefined);
            if (version) {
                return Number.parseInt(version, 10) < 3;
            }
            // 2.x projects are configured with dataform.json instead of workflow_settings.yaml.
            return !fs.existsSync(path.join(root, 'workflow_settings.yaml'));
        })();
        legacyProjectCache.set(root, result);
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------
// Diagnostics

function issueToDiagnostic(document: vscode.TextDocument, issue: ConfigIssue): vscode.Diagnostic {
    const range = new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end));
    const diagnostic = new vscode.Diagnostic(range, issue.message, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = CONFIG_DIAGNOSTIC_SOURCE;
    diagnostic.code = issue.code;
    return diagnostic;
}

async function computeIssues(document: vscode.TextDocument): Promise<ConfigIssue[]> {
    const parsed = parseDocument(document);
    if (!parsed) {
        return [];
    }
    const skipKeyChecks = await isDataformV2Project(document);
    return validateConfigBlock(parsed, { skipKeyChecks });
}

function diagnosticsEnabled(): boolean {
    return vscode.workspace.getConfiguration('vscode-dataform-tools').get<boolean>(DIAGNOSTICS_SETTING, true);
}

function registerDiagnostics(context: vscode.ExtensionContext) {
    const collection = vscode.languages.createDiagnosticCollection('dataformConfig');
    context.subscriptions.push(collection);

    const refresh = async (document: vscode.TextDocument) => {
        if (document.languageId !== 'sqlx') {
            return;
        }
        if (!diagnosticsEnabled()) {
            collection.delete(document.uri);
            return;
        }
        const version = document.version;
        const issues = await computeIssues(document);
        // Skip stale results if the document changed while we were reading the project version.
        if (document.version === version && !document.isClosed) {
            collection.set(document.uri, issues.map(issue => issueToDiagnostic(document, issue)));
        }
    };

    const timers = new Map<string, NodeJS.Timeout>();
    const refreshSoon = (document: vscode.TextDocument) => {
        const key = document.uri.toString();
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            void refresh(document);
        }, 300));
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(refresh),
        vscode.workspace.onDidChangeTextDocument(event => refreshSoon(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => {
            clearTimeout(timers.get(document.uri.toString()));
            collection.delete(document.uri);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(`vscode-dataform-tools.${DIAGNOSTICS_SETTING}`)) {
                vscode.workspace.textDocuments.forEach(document => void refresh(document));
            }
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            // workflow_settings.yaml / dataform.json may have changed the core version.
            if (/(workflow_settings\.yaml|dataform\.json)$/.test(document.fileName)) {
                legacyProjectCache.clear();
                vscode.workspace.textDocuments.forEach(doc => void refresh(doc));
            }
        }),
        { dispose: () => timers.forEach(timer => clearTimeout(timer)) },
    );

    vscode.workspace.textDocuments.forEach(document => void refresh(document));
}

// ---------------------------------------------------------------------------------------------------
// Completion

/** Values of these keys are completed by the providers in src/completions.ts. */
const keysCompletedElsewhere = new Set(['dependencies', 'tags']);

function keyDocumentation(info: KeyInfo, type: SqlxActionType | undefined, path: string[]): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${info.name}**: \`${info.kind}\`\n\n`);
    if (info.doc) {
        markdown.appendMarkdown(`${info.doc}\n\n`);
    }
    if (info.enumValues) {
        markdown.appendMarkdown(`Values: ${info.enumValues.map(v => `\`${v.name}\``).join(', ')}\n\n`);
    }
    const allowedTypes = typesAllowingKey(path, info.name);
    if (allowedTypes.length > 0) {
        markdown.appendMarkdown(`Applies to type: ${allowedTypes.map(t => `\`${t}\``).join(', ')}\n\n`);
    }
    if (type && !allowedTypes.includes(type)) {
        markdown.appendMarkdown(`⚠️ Not valid for type \`${type}\`\n\n`);
    }
    if (info.example) {
        markdown.appendCodeblock(info.example, 'sqlx');
    }
    if (info.docsAnchor) {
        markdown.appendMarkdown(`[Dataform configs reference](${docsUrl(info.docsAnchor)})`);
    }
    return markdown;
}

function valueSnippet(info: KeyInfo): string {
    if (info.enumValues) {
        return `"\${1|${info.enumValues.map(v => v.name).join(',')}|}"`;
    }
    switch (info.kind) {
        case 'string':
            return '"$1"';
        case 'array':
            return '[$1]';
        case 'object':
        case 'map':
            return '{\n\t$1\n}';
        case 'boolean':
            return '${1|true,false|}';
        default:
            return '$1';
    }
}

function keyCompletions(document: vscode.TextDocument, position: vscode.Position, location: ConfigLocation, type: SqlxActionType | undefined): vscode.CompletionItem[] | undefined {
    const keySet = keySetFor(type, location.path);
    if (!keySet) {
        return undefined;
    }
    const existing = new Set(location.object.properties.filter(p => p !== location.property).map(p => p.key));
    const wordRange = document.getWordRangeAtPosition(position, /[\w$]+/);
    // Don't add `key: ` again when renaming a key that already has a value.
    const hasColon = !!location.property && location.property.value.kind !== 'missing' && location.onKey;

    const items: vscode.CompletionItem[] = [];
    for (const info of keySet.values()) {
        if (existing.has(info.name)) {
            continue;
        }
        const item = new vscode.CompletionItem(info.name, vscode.CompletionItemKind.Property);
        item.detail = info.aliasOf ? `${info.kind} (same as ${info.aliasOf})` : info.kind;
        item.documentation = keyDocumentation(info, type, location.path);
        item.insertText = hasColon ? info.name : new vscode.SnippetString(`${info.name}: ${valueSnippet(info)}`);
        item.range = wordRange;
        // Prefer proto names over their legacy aliases, and keep `type` first.
        item.sortText = `${info.name === 'type' ? '0' : info.aliasOf ? '2' : '1'}${info.name}`;
        items.push(item);
    }
    return items;
}

function valueCompletions(document: vscode.TextDocument, position: vscode.Position, location: ConfigLocation, type: SqlxActionType | undefined): vscode.CompletionItem[] | undefined {
    if (keysCompletedElsewhere.has(location.key) && location.path.length === 0) {
        return undefined;
    }
    const info = keySetFor(type, location.path)?.get(location.key);
    if (!info) {
        return undefined;
    }
    const wrap = (value: string) => (location.inString ? value : `"${value}"`);
    const wordRange = document.getWordRangeAtPosition(position, /[\w$]+/);

    if (info.enumValues) {
        return info.enumValues.map((value, index) => {
            const item = new vscode.CompletionItem(value.name, vscode.CompletionItemKind.EnumMember);
            item.insertText = wrap(value.name);
            item.documentation = value.doc ? new vscode.MarkdownString(value.doc) : undefined;
            item.range = wordRange;
            item.sortText = String(index).padStart(3, '0');
            return item;
        });
    }
    if (info.kind === 'boolean' && !location.inString) {
        return ['true', 'false'].map(value => {
            const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
            item.range = wordRange;
            return item;
        });
    }
    return undefined;
}

const completionProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position, _token, context) {
        const found = locationAt(document, position);
        if (!found) {
            return undefined;
        }
        const { parsed, location } = found;
        const type = getActionType(parsed);
        if (location.position === 'value') {
            return valueCompletions(document, position, location, type);
        }
        // A space only matters after `key:`; quotes only inside values.
        if (context.triggerCharacter === ' ' || context.triggerCharacter === '"' || context.triggerCharacter === "'") {
            return undefined;
        }
        return keyCompletions(document, position, location, type);
    },
};

// ---------------------------------------------------------------------------------------------------
// Hover

const hoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
        const found = locationAt(document, position);
        if (!found?.location.property) {
            return undefined;
        }
        const { parsed, location } = found;
        const property = location.property!;
        const type = getActionType(parsed);

        if (location.onKey) {
            // Look the key up for the current type first, then across all types.
            const info = keySetFor(type, location.path)?.get(property.key) ?? keySetFor(undefined, location.path)?.get(property.key);
            if (!info) {
                return undefined;
            }
            const range = new vscode.Range(document.positionAt(property.keyStart), document.positionAt(property.keyEnd));
            return new vscode.Hover(keyDocumentation(info, type, location.path), range);
        }

        const value = property.value;
        const offset = document.offsetAt(position);
        if (value.kind === 'string' && offset >= value.start && offset <= value.end) {
            const info = keySetFor(type, location.path)?.get(property.key);
            const enumValue = info?.enumValues?.find(v => v.name.toUpperCase() === value.text.toUpperCase());
            if (enumValue) {
                const range = new vscode.Range(document.positionAt(value.start), document.positionAt(value.end));
                return new vscode.Hover(new vscode.MarkdownString(`**${property.key}**: \`${enumValue.name}\`\n\n${enumValue.doc}`), range);
            }
        }
        return undefined;
    },
};

// ---------------------------------------------------------------------------------------------------
// Quick fixes

const codeActionProvider: vscode.CodeActionProvider = {
    async provideCodeActions(document, _range, context) {
        const diagnostics = context.diagnostics.filter(d => d.source === CONFIG_DIAGNOSTIC_SOURCE);
        if (diagnostics.length === 0) {
            return undefined;
        }
        // Diagnostics handed back by VS Code are copies, so recompute the issues and match on range.
        const issues = await computeIssues(document);
        const actions: vscode.CodeAction[] = [];
        for (const diagnostic of diagnostics) {
            const start = document.offsetAt(diagnostic.range.start);
            const end = document.offsetAt(diagnostic.range.end);
            const issue = issues.find(i => i.start === start && i.end === end && i.code === diagnostic.code);
            if (!issue) {
                continue;
            }
            if (issue.replacement) {
                const action = new vscode.CodeAction(`Change to "${issue.replacement}"`, vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                action.edit.replace(document.uri, diagnostic.range, issue.replacement);
                action.diagnostics = [diagnostic];
                action.isPreferred = true;
                actions.push(action);
            }
            if (issue.removal && (issue.code === 'key-not-for-type' || issue.code === 'unknown-key' || issue.code === 'duplicate-key')) {
                const key = document.getText(diagnostic.range);
                const action = new vscode.CodeAction(`Remove "${key}"`, vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                action.edit.delete(document.uri, new vscode.Range(document.positionAt(issue.removal.start), document.positionAt(issue.removal.end)));
                action.diagnostics = [diagnostic];
                actions.push(action);
            }
        }
        return actions;
    },
};

export function registerConfigBlockFeatures(context: vscode.ExtensionContext) {
    registerDiagnostics(context);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(SQLX_SELECTOR, completionProvider, ' ', '"', "'"),
        vscode.languages.registerHoverProvider(SQLX_SELECTOR, hoverProvider),
        vscode.languages.registerCodeActionsProvider(SQLX_SELECTOR, codeActionProvider, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
        }),
    );
}
