import catalogJson from '../../snippets/bigquery-functions.json';

/*
 * The BigQuery functions the editor explains: what each takes, what it returns and where its docs are. They are
 * written in snippets/bigquery-functions.json; the snippets, the hover and the signature help are all made from it,
 * and `just bigquery-snippets` writes the snippet file of them (snippets/bigquery-functions.code-snippets.json).
 * Nothing here needs VS Code, so the generator and the tests use it as it is.
 */

export interface FunctionParam {
    name: string;
    /** As said beside the name, e.g. `INT64` or `DATE | DATETIME` */
    type: string;
    doc?: string;
    /** Left out by the snippet, and shown in brackets */
    optional?: boolean;
    /** Takes any number more of the same, comma separated */
    repeated?: boolean;
    /** The fixed set of values, offered as a dropdown by the snippet. A string names one of the catalog's `valueSets` */
    values?: string[] | string;
    /** The keyword before the argument where it is not a comma, e.g. `AS` or `FROM` */
    before?: string;
    /** What the snippet inserts: `{text}` is a tab stop holding `text`, `{A|B}` a dropdown. By default the name or the values */
    snippet?: string;
}

export interface FunctionSignature {
    params: FunctionParam[];
    returns: string;
}

export interface BigQueryFunction {
    name: string;
    doc: string;
    signatures: FunctionSignature[];
    /** A window function: `required` takes an OVER clause always, `optional` may take one */
    window?: 'required' | 'optional';
    /** What the snippet puts in the OVER clause it needs, in the form of `FunctionParam.snippet` */
    over?: string;
    notes?: string[];
    example?: { sql: string; result: string };
    url: string;
}

interface CatalogFile {
    valueSets: Record<string, string[]>;
    functions: BigQueryFunction[];
}

const catalog = catalogJson as CatalogFile;

/** The catalog's functions, with each param's named value set looked up */
export const BIGQUERY_FUNCTIONS: BigQueryFunction[] = catalog.functions.map((fn) => ({
    ...fn,
    signatures: fn.signatures.map((signature) => ({
        ...signature,
        params: signature.params.map((param) => (typeof param.values === 'string' ? { ...param, values: valueSet(param.values) } : param)),
    })),
}));

function valueSet(name: string): string[] {
    const values = catalog.valueSets[name];
    if (!values) {
        throw new Error(`snippets/bigquery-functions.json: no value set named "${name}"`);
    }
    return values;
}

const byName = new Map(BIGQUERY_FUNCTIONS.map((fn) => [fn.name, fn]));

/** The function of a name as written in SQL, in any case and with or without the SAFE. prefix */
export function functionNamed(name: string): BigQueryFunction | undefined {
    const upper = name.toUpperCase();
    return byName.get(upper) ?? (upper.startsWith('SAFE.') ? byName.get(upper.slice('SAFE.'.length)) : undefined);
}

export function valuesOf(param: FunctionParam): string[] | undefined {
    return typeof param.values === 'string' ? valueSet(param.values) : param.values;
}

/** One signature as a line, and where each param is in it, for the signature help to highlight */
export function signatureLabel(fn: BigQueryFunction, signature: FunctionSignature): { label: string; params: [number, number][] } {
    let label = `${fn.name}(`;
    const params: [number, number][] = [];
    signature.params.forEach((param, index) => {
        const separator = index === 0 ? '' : param.before ? ` ${param.before} ` : ', ';
        // An optional keyword argument as ` [AT TIME ZONE ...]`, an optional comma one as `[, ...]`
        label += !param.optional ? separator : separator.startsWith(' ') ? ` [${separator.trimStart()}` : `[${separator}`;
        const start = label.length;
        label += `${param.name}: ${param.type}`;
        params.push([start, label.length]);
        if (param.repeated) {
            label += ', ...';
        }
        if (param.optional) {
            label += ']';
        }
    });
    label += ')';
    if (fn.window === 'required') {
        label += ' OVER (...)';
    }
    return { label: `${label} → ${signature.returns}`, params };
}

/** What the snippet of a function inserts: its first signature's required args, and the OVER clause it needs */
export function snippetBody(fn: BigQueryFunction): string {
    let stop = 0;
    const tabStop = (text: string) => {
        stop += 1;
        return text.includes('|') ? `\${${stop}|${text.split('|').map(escapeChoice).join(',')}|}` : `\${${stop}:${escapePlaceholder(text)}}`;
    };
    const fillTemplate = (template: string) => template.replace(/\{([^{}]*)\}/g, (_, text: string) => tabStop(text));
    const args = fn.signatures[0].params
        .filter((param) => !param.optional)
        .map((param, index) => {
            const separator = index === 0 ? '' : param.before ? ` ${param.before} ` : ', ';
            const values = valuesOf(param);
            const template = param.snippet ?? (values ? `{${values.join('|')}}` : `{${param.name}}`);
            return separator + fillTemplate(template);
        })
        .join('');
    let body = `${fn.name}(${args})`;
    if (fn.window === 'required') {
        body += ` OVER (${fillTemplate(fn.over ?? 'PARTITION BY {partition_expr} ORDER BY {order_expr}')})`;
    }
    return body;
}

function escapePlaceholder(text: string): string {
    return text.replace(/[$}\\]/g, (char) => `\\${char}`);
}

function escapeChoice(text: string): string {
    return text.replace(/[$|,\\]/g, (char) => `\\${char}`);
}

/** The hover of a function: its signatures, what it does, its params, an example and the docs link */
export function functionHoverMarkdown(fn: BigQueryFunction): string {
    const parts: string[] = [];
    parts.push('```sql\n' + fn.signatures.map((signature) => signatureLabel(fn, signature).label).join('\n') + '\n```');
    parts.push(fn.doc);
    const seen = new Set<string>();
    const params: string[] = [];
    for (const param of fn.signatures.flatMap((signature) => signature.params)) {
        if (seen.has(param.name)) {
            continue;
        }
        seen.add(param.name);
        const text = paramText(param);
        if (text) {
            params.push(`- \`${param.name}\` — ${text}`);
        }
    }
    if (params.length > 0) {
        parts.push(params.join('\n'));
    }
    const notes = [...(fn.notes ?? []), ...windowNote(fn)];
    if (notes.length > 0) {
        parts.push(notes.join('\n\n'));
    }
    if (fn.example) {
        parts.push(`Example: \`${fn.example.sql}\` → ${fn.example.result}`);
    }
    parts.push(`[BigQuery docs](${fn.url})`);
    return parts.join('\n\n');
}

/** What the signature help says under a param, and the hover beside its name */
export function paramText(param: FunctionParam): string {
    const values = valuesOf(param);
    return [
        param.doc ? `${param.doc[0].toUpperCase()}${param.doc.slice(1)}.` : '',
        values ? `One of: ${values.map((value) => `\`${value}\``).join(', ')}.` : '',
        param.optional ? 'Optional.' : '',
    ].filter(Boolean).join(' ');
}

function windowNote(fn: BigQueryFunction): string[] {
    if (fn.window === 'required') {
        return ['A window function: it takes `OVER (PARTITION BY … ORDER BY …)`.'];
    }
    if (fn.window === 'optional') {
        return ['Also a window function with `OVER (...)`.'];
    }
    return [];
}

/** The completion line of a function's snippet: its first signature and what it does */
export function snippetDescription(fn: BigQueryFunction): string {
    return `${signatureLabel(fn, fn.signatures[0]).label}\n${fn.doc}`;
}

/** The snippet file of the catalog, as `just bigquery-snippets` writes it */
export function generatedSnippets(): Record<string, { prefix: string; body: string; description: string }> {
    const snippets: Record<string, { prefix: string; body: string; description: string }> = {};
    for (const fn of BIGQUERY_FUNCTIONS) {
        snippets[`${fn.name}()`] = { prefix: fn.name, body: snippetBody(fn), description: snippetDescription(fn) };
    }
    return snippets;
}

/** The text of the snippet file, as committed */
export function generatedSnippetsText(): string {
    return JSON.stringify(generatedSnippets(), null, 2) + '\n';
}

/** A snippet body as plain SQL: each tab stop's text, a dropdown's values as `A|B` */
export function withoutTabStops(body: string): string {
    let text = '';
    // How many `${n:` are open: an unescaped `}` closes the last, and any other brace is text
    let open = 0;
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (char === '\\' && i + 1 < body.length) {
            text += body[++i];
            continue;
        }
        const stop = /^\$(\d+)|^\$\{(\d+)([:|])/.exec(body.slice(i));
        if (stop?.[1] !== undefined) {
            i += stop[0].length - 1;
            continue;
        }
        if (stop?.[3] === ':') {
            open += 1;
            i += stop[0].length - 1;
            continue;
        }
        if (stop?.[3] === '|') {
            const end = body.indexOf('|}', i + stop[0].length);
            const choices = body.slice(i + stop[0].length, end < 0 ? body.length : end);
            text += choices.split(',').join('|');
            i = end < 0 ? body.length : end + 1;
            continue;
        }
        if (char === '}' && open > 0) {
            open -= 1;
            continue;
        }
        text += char;
    }
    return text;
}
