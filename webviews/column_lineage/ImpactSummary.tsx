import { ReactNode, useState } from 'react';
import type { ImpactColumn, ImpactReader, ImpactSeverity, ImpactTable, ImpactView } from '../../src/shared/columnLineage/impactSummary';
import {
    LINK_LABELS, describeChange, impactSeverity, isSettled, openReaders, otherProject, safeSummary, shortTable, summaryCounts,
} from '../../src/shared/columnLineage/impactSummary';
import type { Bridge } from './bridge';

const RELATION: Record<ImpactReader['dependencyType'], { label: string; className: string }> = {
    EXACT_COPY: { label: LINK_LABELS.EXACT_COPY, className: 'ln-rel-copy' },
    OTHER: { label: LINK_LABELS.OTHER, className: 'ln-rel-xform' },
    TABLE_ONLY: { label: LINK_LABELS.TABLE_ONLY, className: 'ln-rel-table' },
};

/** Everything starts open when it shows this many rows or fewer, else everything starts collapsed */
const OPEN_UP_TO = 25;

/** Keys of the parts that collapse: a column's readers, a deleted table's readers, and the lists after the tables */
const groupKey = (table: string, column = '') => `${table}#${column}`;
const SAFE_KEY = '#safe';
const UNCHECKED_KEY = '#unchecked';

/** Every part that collapses, with the rows it shows when open */
function collapsibles(impact: ImpactView): [string, number][] {
    const rows = (readers: ImpactReader[] | undefined) => Math.max(1, readers?.length ?? 0);
    const parts: [string, number][] = impact.atRisk.flatMap((entry): [string, number][] => entry.deleted
        ? [[groupKey(entry.table), rows(entry.readers)]]
        : entry.columns.map((column) => [groupKey(entry.table, column.column), rows(column.readers)]));
    if (impact.safe.length) {
        parts.push([SAFE_KEY, impact.safe.length]);
    }
    if (impact.unchecked.length) {
        parts.push([UNCHECKED_KEY, impact.unchecked.length]);
    }
    return parts;
}

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
}

function formatChecked(checkedAt: number | undefined, now: number): string {
    if (!checkedAt) {
        return '';
    }
    const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
    if (seconds < 10) {
        return 'checked just now';
    }
    return seconds < 90 ? `checked ${seconds} s ago` : `checked ${Math.round(seconds / 60)} min ago`;
}

const SEVERITY_TITLES: Record<ImpactSeverity, string> = {
    critical: 'Dropped or deleted, and still read',
    warning: 'Retyped, and still read',
    low: 'Nothing found still reading it',
    unknown: "Readers couldn't be looked up",
};

function SeverityBadge({ severity }: { severity: ImpactSeverity }) {
    return <span className={`ln-sev ln-sev-${severity}`} title={SEVERITY_TITLES[severity]}>{severity}</span>;
}

function TableLink({ table, fileName, bridge }: { table: string; fileName?: string; bridge: Bridge }) {
    return fileName
        ? <button type="button" className="ln-file" title={`Open ${fileName}`} onClick={() => bridge.post({ type: 'openTableFile', table })}>{shortTable(table)}</button>
        : <span title={table}>{shortTable(table)}</span>;
}

function ReaderNotes({ reader }: { reader: ImpactReader }) {
    return (
        <>
            {!reader.filePath && !reader.deletedOnBranch && <span className="ln-impact-note ln-impact-outside">outside project</span>}
            {reader.deletedOnBranch && <span className="ln-impact-note" title="Deleted on this branch, so it stops reading this">deleted here</span>}
            {reader.probablyUpdated
                ? <span className="ln-impact-note" title="Changed on this branch, and its new SQL no longer names it. An alias or SELECT * can fool this check.">changed here, probably updated</span>
                : reader.changedOnBranch && (
                    <span className="ln-impact-note" title={reader.stillNamed ? 'Changed on this branch, and its new SQL still names it' : 'Changed on this branch'}>
                        {reader.stillNamed ? 'changed here, still names it' : 'changed here'}
                    </span>
                )}
        </>
    );
}

/** Readers of `table`. `wholeTable`: readers of a deleted table, which read it whatever their link says */
function ReaderRows({ table, readers, error, bridge, wholeTable }: { table: string; readers: ImpactReader[]; error?: string; bridge: Bridge; wholeTable?: boolean }) {
    if (error) {
        return <tr className="ln-group-item"><td colSpan={3} className="ln-side-error">Readers couldn't be looked up: {error}</td></tr>;
    }
    if (!readers.length) {
        return (
            <tr className="ln-group-item">
                <td colSpan={3} className="ln-cell-none">No readers found in Dataplex. It keeps 30 days of runs and can't see BI tools or notebooks.</td>
            </tr>
        );
    }
    return (
        <>
            {readers.map((reader) => {
                const relation = wholeTable ? { label: 'reads the table', className: 'ln-rel-whole' } : RELATION[reader.dependencyType];
                const project = otherProject(reader.table, table);
                return (
                    <tr key={`${reader.table}#${reader.column ?? ''}`} className={`ln-group-item${isSettled(reader) ? ' is-settled' : ''}`}>
                        <td className="ln-cell-table">
                            {project && <span className="ln-dataset">{project}.</span>}
                            <TableLink table={reader.table} fileName={reader.filePath} bridge={bridge} />
                            {reader.column && <span className="ln-impact-reader-col">.{reader.column}</span>}
                        </td>
                        <td><span className={`ln-rel ${relation.className}`}>{relation.label}</span></td>
                        <td><ReaderNotes reader={reader} /></td>
                    </tr>
                );
            })}
        </>
    );
}

function readerCount(readers: ImpactReader[] | undefined): string {
    const updated = (readers ?? []).filter((reader) => reader.probablyUpdated).length;
    const deleted = (readers ?? []).filter((reader) => reader.deletedOnBranch).length;
    return [plural(openReaders(readers), 'reader'), updated && `${updated} probably updated`, deleted && `${deleted} deleted here`].filter(Boolean).join(' · ');
}

function GroupHead({ label, change, severity, readers, error, open, onToggle, children }: {
    label: string; change: string; severity: ImpactSeverity; readers: ImpactReader[] | undefined; error?: string; open: boolean; onToggle: () => void; children?: ReactNode;
}) {
    return (
        <tr className="ln-group-row">
            <th scope="rowgroup" colSpan={3}>
                <div className="ln-group-head">
                    <button type="button" className="ln-group-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`} onClick={onToggle}>
                        <span className="ln-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    </button>
                    <SeverityBadge severity={severity} />
                    <span className="ln-impact-col">{label}</span>
                    <span className="ln-chip ln-impact-change">{change}</span>
                    <span className="ln-group-meta">{error ? 'readers unknown' : readerCount(readers)}</span>
                    <span className="ln-grow" />
                    {children}
                </div>
            </th>
        </tr>
    );
}

function ColumnGroup({ table, column, open, onToggle, bridge }: { table: string; column: ImpactColumn; open: boolean; onToggle: () => void; bridge: Bridge }) {
    return (
        <tbody className="ln-group">
            <GroupHead label={column.column} change={describeChange(column.change)} severity={impactSeverity(column.change, column.readers, column.readersError)} readers={column.readers} error={column.readersError} open={open} onToggle={onToggle}>
                <button type="button" className="ln-link" onClick={() => bridge.post({ type: 'traceImpactColumn', table, column: column.column })}>Trace</button>
            </GroupHead>
            {open && <ReaderRows table={table} readers={column.readers} error={column.readersError} bridge={bridge} />}
        </tbody>
    );
}

function AtRiskTable({ entry, isOpen, toggle, bridge }: { entry: ImpactTable; isOpen: (column?: string) => boolean; toggle: (column?: string) => void; bridge: Bridge }) {
    return (
        <section className="ln-list-section">
            <h2 className="ln-list-heading ln-impact-table">
                <TableLink table={entry.table} fileName={entry.fileName} bridge={bridge} />
                <span className="ln-list-count">
                    {entry.deleted
                        ? 'deleted on this branch'
                        : plural(entry.columns.length, 'dropped or retyped column')}
                </span>
            </h2>
            <div className="ln-table-wrap">
                <table className="ln-table-list ln-impact-list">
                    <thead><tr><th>Reader</th><th>Link</th><th>On this branch</th></tr></thead>
                    {entry.deleted
                        ? (
                            <tbody className="ln-group">
                                <GroupHead label="whole table" change="deleted" severity={impactSeverity('deleted', entry.readers, entry.readersError)} readers={entry.readers} error={entry.readersError} open={isOpen()} onToggle={() => toggle()} />
                                {isOpen() && <ReaderRows table={entry.table} readers={entry.readers ?? []} error={entry.readersError} bridge={bridge} wholeTable />}
                            </tbody>
                        )
                        : entry.columns.map((column) => (
                            <ColumnGroup key={column.column} table={entry.table} column={column} open={isOpen(column.column)} onToggle={() => toggle(column.column)} bridge={bridge} />
                        ))}
                </table>
            </div>
        </section>
    );
}

/** `toggleAll`: collapses or expands every group, when there are any */
function Header({ impact, bridge, now, toggleAll }: { impact: ImpactView; bridge: Bridge; now: number; toggleAll?: { label: string; onClick: () => void } }) {
    const comparison = impact.comparison;
    const running = impact.status === 'running';
    return (
        <div className="ln-bar">
            <div className="ln-bar-head">
                <span className="ln-eyebrow">Column impact</span>
                {comparison && (
                    <span className="ln-bar-table" title={comparison.headLabel}>
                        {comparison.headRef} <span className="ln-dataset">vs</span> {comparison.baseRef} <span className="ln-dataset">@ {comparison.mergeBaseSha.slice(0, 7)}</span>
                    </span>
                )}
                <span className="ln-grow" />
                {impact.stale && <span className="ln-chip ln-chip-warn" role="status">Out of date</span>}
                {!running && <span className="ln-bar-checked">{formatChecked(impact.checkedAt, now)}</span>}
                {toggleAll && <button type="button" className="ln-button ln-button-primary" onClick={toggleAll.onClick}>{toggleAll.label}</button>}
                {impact.status === 'ready' && !impact.message && (
                    <button type="button" className="ln-button ln-button-primary" onClick={() => bridge.post({ type: 'copyImpactMarkdown' })}>Copy as Markdown</button>
                )}
                {running
                    ? <button type="button" className="ln-button ln-button-primary" onClick={() => bridge.post({ type: 'cancelImpact' })}>Cancel</button>
                    : <button type="button" className="ln-button ln-button-primary" onClick={() => bridge.post({ type: 'refreshImpact' })}>{impact.status === 'ready' ? 'Check again' : 'Run again'}</button>}
            </div>
            <div className="ln-bar-status" role="status">
                {running && impact.progress
                    ? `${impact.progress.phase}${impact.progress.total ? ` ${impact.progress.done}/${impact.progress.total}` : '…'}`
                    : impact.status === 'cancelled'
                        ? 'Cancelled.'
                        : impact.status === 'error'
                            ? <span className="ln-side-error">{impact.message}</span>
                            : impact.message ?? summaryCounts(impact)}
            </div>
        </div>
    );
}

/** The column impact of the branch: tables with dropped or retyped columns and who reads them, then the rest */
export function ImpactSummary({ impact, bridge, now }: { impact: ImpactView; bridge: Bridge; now: number }) {
    const ready = impact.status === 'ready' && !impact.message;
    const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
    const parts = ready ? collapsibles(impact) : [];
    const startsOpen = parts.reduce((sum, [, rows]) => sum + rows, 0) <= OPEN_UP_TO;
    const isOpen = (key: string) => toggled.get(key) ?? startsOpen;
    const setOpen = (key: string, open: boolean) => setToggled((current) => new Map(current).set(key, open));
    const anyOpen = parts.some(([key]) => isOpen(key));
    const toggleAll = parts.length
        ? { label: anyOpen ? 'Collapse all' : 'Expand all', onClick: () => setToggled(new Map(parts.map(([key]) => [key, !anyOpen]))) }
        : undefined;
    return (
        <div className="ln-stack">
            <Header impact={impact} bridge={bridge} now={now} toggleAll={toggleAll} />
            {ready && (
                <div className="ln-list">
                    {impact.atRisk.length === 0 && (
                        <div className="ln-banner" role="note">
                            <strong>Nothing at risk.</strong> No changed table drops or retypes a column against prod, and no table is deleted.
                        </div>
                    )}
                    {impact.atRisk.map((entry) => (
                        <AtRiskTable
                            key={entry.table}
                            entry={entry}
                            isOpen={(column) => isOpen(groupKey(entry.table, column))}
                            toggle={(column) => setOpen(groupKey(entry.table, column), !isOpen(groupKey(entry.table, column)))}
                            bridge={bridge}
                        />
                    ))}
                    {impact.safe.length > 0 && (
                        <details className="ln-impact-more" open={isOpen(SAFE_KEY)} onToggle={(event) => setOpen(SAFE_KEY, event.currentTarget.open)}>
                            <summary>{safeSummary(impact.safe.length)}</summary>
                            <ul>
                                {impact.safe.map((entry) => (
                                    <li key={entry.table}>
                                        <TableLink table={entry.table} fileName={entry.fileName} bridge={bridge} />
                                        {entry.added?.length ? <span className="ln-dataset"> · adds {entry.added.join(', ')}</span> : null}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                    {impact.unchecked.length > 0 && (
                        <details className="ln-impact-more" open={isOpen(UNCHECKED_KEY)} onToggle={(event) => setOpen(UNCHECKED_KEY, event.currentTarget.open)}>
                            <summary>Not checked ({impact.unchecked.length})</summary>
                            <ul>
                                {impact.unchecked.map((entry) => (
                                    <li key={entry.table}>
                                        <TableLink table={entry.table} fileName={entry.fileName} bridge={bridge} />
                                        <span className="ln-dataset">: {entry.reason}</span>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                    <p className="ln-list-hidden">
                        Readers come from Dataplex lineage of prod runs in the last 30 days, about 2 h behind. Readers changed on this branch are
                        checked by whether their new SQL still names the column, which an alias or SELECT * can fool.
                    </p>
                </div>
            )}
        </div>
    );
}
