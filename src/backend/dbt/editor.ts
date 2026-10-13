import type { ActionId, CompiledGraph, Kind } from '../../shared/compiledGraph';
import type { Editor, EditorDocument, EditorPlace } from '../backend';
import type { DbtGraph, DbtMacro, DbtName } from './graph';
import { JinjaCall, callAt, columnAt, jinjaCalls, tableAliases, typingArgument } from './jinja';
import { definitionLine, testLine } from './locate';

/*
 * The dbt Backend's `editor` part (piece 7.4 of the build plan): what a `ref()`, a `source()` or a macro call in the
 * text of a file names, by dbt's own rules, from the names and macros the last compile gave. The text is read by
 * jinja.ts; nothing here reads a file.
 */

/** What `ref()` can name: a model of any materialisation, a seed or a snapshot */
const REF_KINDS = new Set<Kind>(['table', 'view', 'incremental', 'materialized view', 'ephemeral', 'seed', 'snapshot']);

/** Where `dbt deps` installs packages, as graph.ts has it */
const PACKAGE_FILE = /^dbt_(?:packages|modules)\/([^/]+)\//;

const isYaml = (file: string) => /\.ya?ml$/i.test(file);

interface Named {
    id: ActionId;
    name: DbtName;
    disabled: boolean;
}

class DbtEditor {
    private readonly graph: CompiledGraph;
    private readonly refs: Named[] = [];
    private readonly sources: Named[] = [];

    constructor(private readonly data: DbtGraph) {
        this.graph = data.graph;
        for (const [id, name] of Object.entries(data.dbt.names)) {
            const action = this.graph.actions[id];
            if (!action) {
                continue;
            }
            const named = { id, name, disabled: action.disabled === true };
            if (action.kind === 'source') {
                this.sources.push(named);
            } else if (REF_KINDS.has(action.kind)) {
                this.refs.push(named);
            }
        }
    }

    /** The package a file is of: an installed one's files are under its own directory */
    private packageOf(file: string): string {
        return PACKAGE_FILE.exec(file)?.[1] ?? this.data.dbt.projectName;
    }

    /**
     * The one a call written in `file` names when several packages have the name: the file's own package, then the
     * Project, then any, as dbt looks.
     */
    private nearest<T>(candidates: T[], packageName: (candidate: T) => string, file: string): T | undefined {
        const order = [this.packageOf(file), this.data.dbt.projectName];
        return order.map((name) => candidates.find((candidate) => packageName(candidate) === name)).find((found) => found) ?? candidates[0];
    }

    /** The Action a `ref()` or `source()` call written in `file` names */
    resolve(call: JinjaCall, file: string): ActionId | undefined {
        const args = call.args.map((argument) => argument.value);
        if (call.kind === 'source') {
            return args.length === 2 ? this.sources.find(({ name }) => name.sourceName === args[0] && name.name === args[1])?.id : undefined;
        }
        if (call.kind !== 'ref' || args.length < 1 || args.length > 2) {
            return undefined;
        }
        const name = args[args.length - 1];
        const candidates = this.refs
            .filter((ref) => ref.name.name === name && (args.length === 1 || ref.name.package === args[0]))
            // The version asked for, or the one a `ref()` without a version gives: the latest
            .filter((ref) => (call.version !== undefined ? ref.name.version === call.version : ref.name.version === undefined || ref.name.latest))
            .sort((a, b) => Number(a.disabled) - Number(b.disabled));
        return this.nearest(candidates, (ref) => ref.name.package, file)?.id;
    }

    /** The macro a call written in `file` names: `package.name`, or a name alone */
    macro(written: string, file: string): DbtMacro | undefined {
        const parts = written.split('.');
        if (parts.length > 2) {
            return undefined;
        }
        const name = parts[parts.length - 1];
        const candidates = this.data.dbt.macros.filter((macro) => macro.name === name && (parts.length === 1 || macro.package === parts[0]));
        return this.nearest(candidates, (macro) => macro.package, file);
    }

    placeOf(id: ActionId): EditorPlace | undefined {
        const action = this.graph.actions[id];
        if (!action?.fileName) {
            return undefined;
        }
        const name = this.data.dbt.names[id];
        // A generic test has no entry of its name: it is declared under what it tests
        const test = name?.test;
        if (isYaml(action.fileName) && test) {
            return { fileName: action.fileName, lineIn: (text) => testLine(text, test) };
        }
        // A model's file is the model. What a YAML file defines is one entry of many in it
        return isYaml(action.fileName) && name ? { fileName: action.fileName, lineIn: (text) => definitionLine(text, name) } : { fileName: action.fileName };
    }

    definitionAt({ file, text, offset }: EditorDocument): ReturnType<Editor['definitionAt']> {
        const call = callAt(text, offset, isYaml(file));
        if (!call) {
            return undefined;
        }
        const range = { start: call.start, end: call.end };
        if (call.kind === 'macro') {
            // Only on the name: inside its brackets are arguments, which are not the macro
            const macro = offset <= call.nameEnd ? this.macro(call.name, file) : undefined;
            return macro && { start: call.nameStart, end: call.nameEnd, place: { fileName: macro.fileName, lineIn: (source) => macroLine(source, macro.name) } };
        }
        const id = this.resolve(call, file);
        const place = id === undefined ? undefined : this.placeOf(id);
        return place && { ...range, place };
    }

    tableAt({ file, text, offset }: EditorDocument): ReturnType<Editor['tableAt']> {
        const call = callAt(text, offset, isYaml(file));
        const id = call && call.kind !== 'macro' ? this.resolve(call, file) : undefined;
        return call && id !== undefined ? { start: call.start, end: call.end, id } : undefined;
    }

    columnAt({ file, text, offset }: EditorDocument, typing = false): ReturnType<Editor['columnAt']> {
        const column = isYaml(file) ? undefined : columnAt(text, offset, typing);
        if (!column) {
            return undefined;
        }
        const range = { word: column.word, start: column.start, end: column.end };
        if (column.qualifier === undefined) {
            const read = new Set<ActionId>();
            for (const call of jinjaCalls(text)) {
                const id = call.kind === 'macro' ? undefined : this.resolve(call, file);
                if (id !== undefined) {
                    read.add(id);
                }
            }
            return { ...range, qualified: false, tables: [...read] };
        }
        // The alias the file gives a table, else the table's own name, which SQL takes when there is no alias
        const aliased = tableAliases(text).get(column.qualifier);
        let id = aliased && this.resolve(aliased, file);
        if (!aliased) {
            const qualifier = column.qualifier.toLowerCase();
            id = jinjaCalls(text)
                .filter((call) => call.kind !== 'macro' && !call.alias)
                .map((call) => this.resolve(call, file))
                .find((resolved) => resolved !== undefined && this.graph.actions[resolved].target.name.toLowerCase() === qualifier);
        }
        return { ...range, qualified: true, tables: id === undefined ? [] : [id] };
    }

    namesAt({ file, text, offset }: EditorDocument): ReturnType<Editor['namesAt']> {
        const typing = isYaml(file) ? undefined : typingArgument(text, offset);
        if (!typing || typing.index > 1) {
            return undefined;
        }
        const names = new Map<string, { name: string; detail?: string; id?: ActionId }>();
        const add = (name: string, detail?: string, id?: ActionId) => {
            if (!names.has(name)) {
                names.set(name, { name, ...(detail ? { detail } : {}), ...(id !== undefined ? { id } : {}) });
            }
        };
        const own = this.data.dbt.projectName;
        if (typing.kind === 'source') {
            for (const { id, name, disabled } of this.sources) {
                if (disabled) {
                    continue;
                }
                if (typing.index === 0) {
                    add(name.sourceName ?? '', 'source');
                } else if (name.sourceName === typing.before[0]) {
                    add(name.name, this.graph.actions[id].kind, id);
                }
            }
        } else {
            // The second argument is a name in the package the first one gives
            const refs = this.refs.filter((ref) => !ref.disabled && (typing.index === 0 || ref.name.package === typing.before[0]));
            // The Project's own first, so that its model wins the name over a package's
            for (const { id, name } of [...refs].sort((a, b) => Number(b.name.package === own) - Number(a.name.package === own))) {
                const kind = this.graph.actions[id].kind;
                add(name.name, name.package === own || typing.index === 1 ? kind : `${kind}, ${name.package}`, id);
            }
        }
        return { start: typing.start, names: [...names.values()].filter((each) => each.name !== '').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) };
    }
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The line of `text`, from 0, that starts the macro. A generic test is a macro dbt names `test_<name>` and a file
 * writes as `{% test <name>(...) %}`.
 */
export function macroLine(text: string, name: string): number | undefined {
    const written = [`macro\\s+${escaped(name)}`];
    if (name.startsWith('test_')) {
        written.push(`test\\s+${escaped(name.slice('test_'.length))}`);
    }
    const start = new RegExp(`\\{%-?\\s*(?:${written.join('|')})\\s*\\(`);
    const line = text.split(/\r?\n/).findIndex((each) => start.test(each));
    return line === -1 ? undefined : line;
}

/** The `editor` part over whatever the last compile gave, which `last` reads each time it is asked */
export function dbtEditor(last: () => DbtGraph | undefined): Editor {
    let made: { from: DbtGraph; editor: DbtEditor } | undefined;
    const editor = () => {
        const data = last();
        if (!data) {
            return undefined;
        }
        if (made?.from.graph !== data.graph) {
            made = { from: data, editor: new DbtEditor(data) };
        }
        return made.editor;
    };
    return {
        definitionAt: (document) => editor()?.definitionAt(document),
        tableAt: (document) => editor()?.tableAt(document),
        columnAt: (document, typing) => editor()?.columnAt(document, typing),
        namesAt: (document) => editor()?.namesAt(document),
        placeOf: (id) => editor()?.placeOf(id),
    };
}
