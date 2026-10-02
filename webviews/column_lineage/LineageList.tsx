import { useMemo, useState } from 'react';
import type { LineageDirection, TraceState } from '../../src/shared/columnLineage/types';
import { TraceRow, frontier, traceRows } from '../../src/shared/columnLineage/traceGraph';
import type { Bridge } from './bridge';

const RELATION: Record<TraceRow['dependencyType'], { label: string; className: string }> = {
    EXACT_COPY: { label: 'copy', className: 'ln-rel-copy' },
    OTHER: { label: 'derived or filtered', className: 'ln-rel-xform' },
    TABLE_ONLY: { label: 'may read', className: 'ln-rel-table' },
};

/** `dataset.table`, leaving out the project */
function shortTable(table: string): string {
    return table.split('.').slice(1).join('.') || table;
}

function matches(row: TraceRow, query: string): boolean {
    if (!query) {
        return true;
    }
    const text = `${row.node.table} ${row.node.column ?? ''} ${row.via.map((via) => `${via.table}.${via.column ?? ''}`).join(' ')}`.toLowerCase();
    return query.toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

function Section({ state, direction, query, bridge }: { state: TraceState; direction: LineageDirection; query: string; bridge: Bridge }) {
    const rows = useMemo(() => traceRows(state, direction), [state, direction]);
    const shown = rows.filter((row) => matches(row, query));
    const next = frontier(state, direction);
    const loading = state.nodes.some((node) => node.loading && (direction === 'downstream' ? node.hop >= 0 : node.hop <= 0));
    const errors = state.nodes.filter((node) => node.error && (direction === 'downstream' ? node.hop >= 0 : node.hop < 0));
    const hops = rows.length ? Math.max(...rows.map((row) => Math.abs(row.node.hop))) : 0;
    const tables = new Set(rows.map((row) => row.node.table)).size;
    const title = direction === 'downstream' ? 'Downstream' : 'Upstream';

    return (
        <section className="ln-list-section" aria-label={`${title} columns`}>
            <h2 className="ln-list-heading">
                <span>{title}</span>
                <span className="ln-list-count">
                    {rows.length
                        ? `${rows.length} column${rows.length === 1 ? '' : 's'} in ${tables} table${tables === 1 ? '' : 's'}, ${hops} hop${hops === 1 ? '' : 's'}`
                        : loading ? 'looking up…' : direction === 'downstream' ? 'no readers found' : 'no sources found'}
                </span>
                {query && rows.length > 0 && <span className="ln-list-count">· {shown.length} match</span>}
            </h2>

            {shown.length > 0 && (
                <div className="ln-table-wrap">
                    <table className="ln-table-list">
                        <thead>
                            <tr>
                                <th scope="col" className="ln-col-hop">Hop</th>
                                <th scope="col">Column</th>
                                <th scope="col">Table</th>
                                <th scope="col">Link</th>
                                <th scope="col">{direction === 'downstream' ? 'Reads from' : 'Feeds'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((row) => {
                                const relation = RELATION[row.dependencyType];
                                return (
                                    <tr key={row.node.id}>
                                        <td className="ln-col-hop">{Math.abs(row.node.hop)}</td>
                                        <td className="ln-cell-col">
                                            {row.node.column ?? <span className="ln-cell-none">no column detail</span>}
                                        </td>
                                        <td className="ln-cell-table">
                                            {row.node.filePath
                                                ? <button type="button" className="ln-file" title={`Open ${row.node.filePath}`} onClick={() => bridge.post({ type: 'openFile', nodeId: row.node.id })}>{shortTable(row.node.table)}</button>
                                                : <span title={`${row.node.table} (outside this project)`}>{shortTable(row.node.table)} <span className="ln-outside">outside project</span></span>}
                                        </td>
                                        <td><span className={`ln-rel ${relation.className}`}>{relation.label}</span></td>
                                        <td className="ln-cell-via">
                                            {row.via.map((via) => (via.hop === 0 ? via.column : `${shortTable(via.table)}.${via.column}`)).join(', ')}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {errors.map((node) => <div key={node.id} className="ln-list-error" role="alert">{node.column}: {node.error}</div>)}

            <div className="ln-list-more">
                {loading && <span className="ln-list-loading"><span className="ln-spinner" aria-hidden="true" /> Loading hop…</span>}
                {!loading && next.length > 0 && (
                    <button type="button" className="ln-button" onClick={() => bridge.post({ type: 'expandLevel', direction })}>
                        Load hop {Math.abs(next[0].hop) + 1} ({next.length} column{next.length === 1 ? '' : 's'} to look up)
                    </button>
                )}
            </div>
        </section>
    );
}

/** `hidden`: columns "Copies only" leaves out */
export function LineageList({ state, bridge, hidden, onShowAll }: { state: TraceState; bridge: Bridge; hidden: number; onShowAll: () => void }) {
    const [query, setQuery] = useState('');
    return (
        <div className="ln-list" role="region" aria-label="Lineage list">
            <div className="ln-list-filter">
                <input
                    id="ln-list-filter"
                    type="search"
                    placeholder="Filter by column or table"
                    aria-label="Filter by column or table"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                {hidden > 0 && (
                    <span className="ln-list-hidden" role="status">
                        Copies only: hiding {hidden} column{hidden === 1 ? '' : 's'} linked as derived or filtered.{' '}
                        <button type="button" className="ln-link" onClick={onShowAll}>Show all</button>
                    </span>
                )}
            </div>
            <Section state={state} direction="downstream" query={query} bridge={bridge} />
            {state.upstreamShown && <Section state={state} direction="upstream" query={query} bridge={bridge} />}
        </div>
    );
}
