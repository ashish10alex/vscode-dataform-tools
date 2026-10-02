import { ReactNode, useMemo, useState } from 'react';
import type { LineageDirection, TraceNode, TraceState } from '../../src/shared/columnLineage/types';
import { TraceRow, frontier, traceRows } from '../../src/shared/columnLineage/traceGraph';
import { shownProject } from '../../src/shared/columnLineage/traceCards';
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

/** `dataset.table`, with the project in front when it is shown: see {@link shownProject} */
function tableLabel(node: Pick<TraceNode, 'table' | 'filePath'>, focusTable: string): string {
    const project = shownProject(node, focusTable);
    return project ? `${project}.${shortTable(node.table)}` : shortTable(node.table);
}

interface TableGroup {
    table: string;
    filePath?: string;
    rows: TraceRow[];
    minHop: number;
    maxHop: number;
}

/** One group per table: nearest hop first, then this project's tables, then the most columns, "may read" ones last */
function groupByTable(rows: TraceRow[]): TableGroup[] {
    const groups = new Map<string, TableGroup>();
    for (const row of rows) {
        const hop = Math.abs(row.node.hop);
        const group = groups.get(row.node.table);
        if (group) {
            group.rows.push(row);
            group.minHop = Math.min(group.minHop, hop);
            group.maxHop = Math.max(group.maxHop, hop);
        } else {
            groups.set(row.node.table, { table: row.node.table, filePath: row.node.filePath, rows: [row], minHop: hop, maxHop: hop });
        }
    }
    const onlyMayRead = (group: TableGroup) => Number(group.rows.every((row) => row.dependencyType === 'TABLE_ONLY'));
    return [...groups.values()].sort((a, b) => a.minHop - b.minHop
        || Number(!a.filePath) - Number(!b.filePath)
        || onlyMayRead(a) - onlyMayRead(b)
        || b.rows.length - a.rows.length
        || a.table.localeCompare(b.table));
}

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** e.g. "hops 1–2 · 3 columns · 2 copies, 1 derived" */
function groupSummary(group: TableGroup): string {
    const hops = group.minHop === group.maxHop ? `hop ${group.minHop}` : `hops ${group.minHop}–${group.maxHop}`;
    const columns = group.rows.filter((row) => row.node.column).length;
    const byType = (type: TraceRow['dependencyType']) => group.rows.filter((row) => row.dependencyType === type).length;
    const links = [
        byType('EXACT_COPY') && plural(byType('EXACT_COPY'), 'copy', 'copies'),
        byType('OTHER') && `${byType('OTHER')} derived`,
        byType('TABLE_ONLY') && 'may read',
    ].filter(Boolean).join(', ');
    return [hops, columns && plural(columns, 'column'), links].filter(Boolean).join(' · ');
}

function TableName({ table, filePath, nodeId, focusTable, bridge }: { table: string; filePath?: string; nodeId: string; focusTable: string; bridge: Bridge }) {
    if (filePath) {
        return <button type="button" className="ln-file" title={`Open ${filePath}`} onClick={() => bridge.post({ type: 'openFile', nodeId })}>{shortTable(table)}</button>;
    }
    const project = shownProject({ table }, focusTable);
    return (
        <span title={`${table} (outside this project)`}>
            {project && <span className="ln-dataset">{project}.</span>}{shortTable(table)} <span className="ln-outside">outside project</span>
        </span>
    );
}

function Rows({ rows, showTable, focusTable, bridge }: { rows: TraceRow[]; showTable?: boolean; focusTable: string; bridge: Bridge }) {
    return (
        <>
            {rows.map((row) => {
                const relation = RELATION[row.dependencyType];
                return (
                    <tr key={row.node.id} className="ln-group-item">
                        <td className="ln-col-hop">{Math.abs(row.node.hop)}</td>
                        <td className="ln-cell-col">
                            {row.node.column ?? <span className="ln-cell-none">no column detail</span>}
                            {showTable && <div className="ln-cell-table ln-cell-sub"><TableName table={row.node.table} filePath={row.node.filePath} nodeId={row.node.id} focusTable={focusTable} bridge={bridge} /></div>}
                        </td>
                        <td><span className={`ln-rel ${relation.className}`}>{relation.label}</span></td>
                        <td className="ln-cell-via">
                            {row.via.map((via) => (via.hop === 0 ? via.column : via.column ? `${tableLabel(via, focusTable)}.${via.column}` : tableLabel(via, focusTable))).join(', ')}
                        </td>
                    </tr>
                );
            })}
        </>
    );
}

function GroupHeader({ open, onToggle, children, label }: { open: boolean; onToggle: () => void; children: ReactNode; label: string }) {
    return (
        <tr className="ln-group-row">
            <th scope="rowgroup" colSpan={4}>
                <div className="ln-group-head">
                    <button type="button" className="ln-group-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} onClick={onToggle}>
                        <span className="ln-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    </button>
                    {children}
                </div>
            </th>
        </tr>
    );
}

/** Toggle key of the assertions group; never a table name, which has dots */
const ASSERTIONS_KEY = 'assertions';

function Section({ state, direction, bridge }: { state: TraceState; direction: LineageDirection; bridge: Bridge }) {
    const rows = useMemo(() => traceRows(state, direction), [state, direction]);
    const groups = groupByTable(rows.filter((row) => !row.node.assertion));
    const assertionRows = rows.filter((row) => row.node.assertion);
    const assertionTables = new Set(assertionRows.map((row) => row.node.table)).size;
    // Groups toggled open, by table; every group starts collapsed. The section is keyed by the focus column, so this starts empty for each column.
    const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());

    const next = frontier(state, direction);
    const onSide = (node: TraceNode) => (direction === 'downstream' ? node.hop >= 0 : node.hop <= 0);
    const loading = state.nodes.some((node) => node.loading && onSide(node));
    const checking = state.nodes.some((node) => node.checkingReaders && onSide(node));
    const errors = state.nodes.filter((node) => node.error && (direction === 'downstream' ? node.hop >= 0 : node.hop < 0));
    const readerErrors = state.nodes.filter((node) => node.readersError && onSide(node));
    const hops = rows.length ? Math.max(...rows.map((row) => Math.abs(row.node.hop))) : 0;
    const tables = new Set(rows.map((row) => row.node.table)).size;
    const title = direction === 'downstream' ? 'Downstream' : 'Upstream';
    const focusTable = state.focus.table;

    const isOpen = (key: string) => toggled.get(key) ?? false;
    const toggle = (key: string) => setToggled((current) => new Map(current).set(key, !isOpen(key)));
    const allOpen = groups.every((group) => isOpen(group.table));
    const setAll = (open: boolean) => setToggled(new Map(groups.map((group) => [group.table, open])));

    return (
        <section className="ln-list-section" aria-label={`${title} columns`}>
            <h2 className="ln-list-heading">
                <span>{title}</span>
                <span className="ln-list-count">
                    {rows.length
                        ? `${plural(rows.length, 'column')} in ${plural(tables, 'table')}, ${plural(hops, 'hop')}`
                        : loading ? 'looking up…' : checking ? 'checking readers without column lineage…' : direction === 'downstream' ? 'no readers found' : 'no sources found'}
                </span>
                {groups.length > 1 && (
                    <button type="button" className="ln-link ln-list-toggle-all" onClick={() => setAll(!allOpen)}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
                )}
            </h2>

            {rows.length > 0 && (
                <div className="ln-table-wrap">
                    <table className="ln-table-list">
                        <thead>
                            <tr>
                                <th scope="col" className="ln-col-hop">Hop</th>
                                <th scope="col">Column</th>
                                <th scope="col">Link</th>
                                <th scope="col">{direction === 'downstream' ? 'Reads from' : 'Feeds'}</th>
                            </tr>
                        </thead>
                        {groups.map((group) => {
                            const open = isOpen(group.table);
                            return (
                                <tbody key={group.table} className="ln-group">
                                    <GroupHeader open={open} label={tableLabel(group, focusTable)} onToggle={() => toggle(group.table)}>
                                        <span className="ln-cell-table"><TableName table={group.table} filePath={group.filePath} nodeId={group.rows[0].node.id} focusTable={focusTable} bridge={bridge} /></span>
                                        <span className="ln-group-meta">{groupSummary(group)}</span>
                                    </GroupHeader>
                                    {open && <Rows rows={group.rows} focusTable={focusTable} bridge={bridge} />}
                                </tbody>
                            );
                        })}
                        {assertionRows.length > 0 && (
                            <tbody className="ln-group ln-group-assertions">
                                <GroupHeader open={isOpen(ASSERTIONS_KEY)} label="assertions" onToggle={() => toggle(ASSERTIONS_KEY)}>
                                    <span className="ln-group-title">{plural(assertionTables, 'assertion')}</span>
                                    <span className="ln-group-meta">{plural(assertionRows.length, 'column')} · checks only, not models</span>
                                </GroupHeader>
                                {isOpen(ASSERTIONS_KEY) && <Rows rows={assertionRows} showTable focusTable={focusTable} bridge={bridge} />}
                            </tbody>
                        )}
                    </table>
                </div>
            )}

            {errors.map((node) => <div key={node.id} className="ln-list-error" role="alert">{node.column ?? tableLabel(node, focusTable)}: {node.error}</div>)}
            {readerErrors.map((node) => (
                <div key={`${node.id}-readers`} className="ln-list-error" role="alert">
                    Couldn’t check readers of {tableLabel(node, focusTable)} without column lineage: {node.readersError}
                </div>
            ))}

            <div className="ln-list-more">
                {loading && <span className="ln-list-loading"><span className="ln-spinner" aria-hidden="true" /> Loading hop…</span>}
                {!loading && next.length > 0 && (
                    <button type="button" className="ln-button" onClick={() => bridge.post({ type: 'expandLevel', direction })}>
                        Load hop {Math.abs(next[0].hop) + 1} ({plural(next.length, 'column')} to look up)
                    </button>
                )}
                {checking && rows.length > 0 && (
                    <span className="ln-list-checking" role="status">
                        <span className="ln-spinner" aria-hidden="true" /> Checking readers without column lineage…
                    </span>
                )}
            </div>
        </section>
    );
}

/** `hidden`: columns "Copies only" leaves out */
export function LineageList({ state, bridge, hidden, onShowAll }: { state: TraceState; bridge: Bridge; hidden: number; onShowAll: () => void }) {
    const focusKey = `${state.focus.table}#${state.focus.column}`;
    return (
        <div className="ln-list" role="region" aria-label="Lineage list">
            {hidden > 0 && (
                <span className="ln-list-hidden" role="status">
                    Copies only: hiding {hidden} column{hidden === 1 ? '' : 's'} linked as derived or filtered.{' '}
                    <button type="button" className="ln-link" onClick={onShowAll}>Show all</button>
                </span>
            )}
            <Section key={`down:${focusKey}`} state={state} direction="downstream" bridge={bridge} />
            {state.upstreamShown && <Section key={`up:${focusKey}`} state={state} direction="upstream" bridge={bridge} />}
        </div>
    );
}
