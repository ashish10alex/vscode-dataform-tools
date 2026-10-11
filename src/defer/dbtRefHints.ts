import type { DbtRefRead } from '../backend/dbt';
import { jinjaCalls } from '../backend/dbt/jinja';
import type { ActionId } from '../shared/compiledGraph';
import { builtInDevHint, deferralEntryHint, RefHintKind } from './deferRules';

/*
 * The labels after the `ref()`s of a dbt file, with defer to prod on: read from prod, or from the dbt target because
 * the table is built there. dbt decided which when it compiled the file (src/backend/dbt/defer.ts); this only says
 * it where the `ref()` is written. No `vscode` import: the editor draws what this gives.
 */

/** A label after a `ref()` */
export interface DbtRefHint {
    /** Offsets in the text: from the call's name to after its `}}`, so that the label follows the braces */
    start: number;
    end: number;
    label: string;
    kind: RefHintKind;
    /** Markdown */
    hover: string;
}

/** After a call, the end of the `}}` that closes it when nothing but spaces is between them: else the end of the call */
function afterBraces(text: string, end: number): number {
    const closing = /^[ \t]*-?\}\}/.exec(text.slice(end, end + 40));
    return closing ? end + closing[0].length : end;
}

/**
 * The labels of the `ref()`s in `text`. `resolve` gives the Action a call at an offset names, `reads` what the
 * file's last compile read each upstream table from, and `lastModified` when the table in the dbt target was last
 * built (epoch ms), where that is known. A `ref()` that names an Action the compile said nothing of has no label.
 */
export function dbtRefHints(
    text: string,
    resolve: (offset: number) => ActionId | undefined,
    reads: Record<ActionId, DbtRefRead>,
    lastModified: (id: ActionId) => number | undefined,
    now: number,
): DbtRefHint[] {
    const hints: DbtRefHint[] = [];
    for (const call of jinjaCalls(text)) {
        if (call.kind !== 'ref' || !call.closed) {
            continue;
        }
        const id = resolve(call.start);
        const read = id === undefined ? undefined : reads[id];
        if (id === undefined || !read) {
            continue;
        }
        const said = read.from === 'prod'
            ? deferralEntryHint({ dev: read.dev, prod: read.prod, status: 'deferred' })
            : builtInDevHint({ dev: read.dev, lastModified: lastModified(id) }, now);
        hints.push({ start: call.start, end: afterBraces(text, call.end), label: said.label, kind: said.kind, hover: said.hover });
    }
    return hints;
}
