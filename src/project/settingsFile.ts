import fs from 'fs';
import path from 'path';

/*
 * The settings a Project keeps in its own `.vscode/settings.json`. VS Code reads that file only at the root of a
 * workspace folder, so for a Project below one the extension reads it. No `vscode` import, so it runs in plain Node.
 */

/** The section every setting of the extension is in */
export const SETTINGS_SECTION = 'vscode-dataform-tools';

export const settingsFileOf = (root: string) => path.join(root, '.vscode', 'settings.json');

/**
 * JSON as VS Code writes its settings files, made plain JSON: without `//` and block comments, and without the
 * comma after the last entry of an object or a list. What is inside a string is left as it is.
 */
export function withoutCommentsAndTrailingCommas(text: string): string {
    let plain = '';
    for (let at = 0; at < text.length;) {
        const two = text.slice(at, at + 2);
        if (text[at] === '"') {
            let end = at + 1;
            while (end < text.length && text[end] !== '"') {
                end += text[end] === '\\' ? 2 : 1;
            }
            plain += text.slice(at, end + 1);
            at = end + 1;
        } else if (two === '//') {
            const end = text.indexOf('\n', at);
            at = end === -1 ? text.length : end;
        } else if (two === '/*') {
            const end = text.indexOf('*/', at + 2);
            at = end === -1 ? text.length : end + 2;
        } else if (text[at] === ',' && /^\s*[}\]]/.test(restAfterComments(text, at + 1))) {
            at++;
        } else {
            plain += text[at++];
        }
    }
    return plain;
}

/** What follows `from`, past any comments: enough to tell whether a comma is the last of its object or list */
function restAfterComments(text: string, from: number): string {
    let at = from;
    for (;;) {
        while (at < text.length && /\s/.test(text[at])) {
            at++;
        }
        const two = text.slice(at, at + 2);
        if (two === '//') {
            const end = text.indexOf('\n', at);
            at = end === -1 ? text.length : end;
        } else if (two === '/*') {
            const end = text.indexOf('*/', at + 2);
            at = end === -1 ? text.length : end + 2;
        } else {
            return text.slice(at, at + 1);
        }
    }
}

const held = new Map<string, { modified: number; size: number; values: Record<string, unknown> }>();

/**
 * The extension's settings in the Project's own settings file, by their names without the section. Empty when there
 * is no such file or it does not parse. The file is read again only when it has changed: asking costs one `stat`.
 */
export function projectFileSettings(root: string): Record<string, unknown> {
    const file = settingsFileOf(root);
    let stat: fs.Stats;
    try {
        stat = fs.statSync(file);
    } catch {
        held.delete(file);
        return {};
    }
    const known = held.get(file);
    if (known && known.modified === stat.mtimeMs && known.size === stat.size) {
        return known.values;
    }
    const values: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(withoutCommentsAndTrailingCommas(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [name, value] of Object.entries(parsed)) {
                if (name.startsWith(`${SETTINGS_SECTION}.`)) {
                    values[name.slice(SETTINGS_SECTION.length + 1)] = value;
                }
            }
        }
    } catch {
        // An unreadable file gives no settings, as a missing one does
    }
    held.set(file, { modified: stat.mtimeMs, size: stat.size, values });
    return values;
}
