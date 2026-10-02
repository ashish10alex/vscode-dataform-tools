import { useState } from 'react';
import type { ImpactColumn, ImpactReader, ImpactTable, ImpactView } from '../../src/shared/columnLineage/impactSummary';
import { describeChange, openReaders, safeSummary, shortTable, summaryCounts } from '../../src/shared/columnLineage/impactSummary';
import type { Bridge } from './bridge';

const RELATION: Record<ImpactReader['dependencyType'], { label: string; className: string }> = {
    EXACT_COPY: { label: 'copy', className: 'ln-rel-copy' },
    OTHER: { label: 'derived or filtered', className: 'ln-rel-xform' },
    TABLE_ONLY: { label: 'may read', className: 'ln-rel-table' },
};

/** A column's readers start shown when the table has this many at-risk columns or fewer */
const OPEN_UP_TO = 3;

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

function TableLink({ table, fileName, bridge }: { table: string; fileName?: string; bridge: Bridge }) {
    return fileName
        ? <button type="button" className="ln-file" title={`Open ${fileName}`} onClick={() => bridge.post({ type: 'openTableFile', table })}>{shortTable(table)}</button>
        : <span title={table}>{shortTable(table)}</span>;
}

function ReaderNotes({ reader }: { reader: ImpactReader }) {
    return (
        <>
            {!reader.filePath && <span className="ln-impact-note ln-impact-outside">outside project</span>}
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

/** `wholeTable`: readers of a deleted table, which read it whatever their link says */
function ReaderRows({ readers, error, bridge, wholeTable }: { readers: ImpactReader[]; error?: string; bridge: Bridge; wholeTable?: boolean }) {
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
                return (
                    <tr key={`${reader.table}#${reader.column ?? ''}`} className={`ln-group-item${reader.probablyUpdated ? ' is-settled' : ''}`}>
                        <td className="ln-cell-table">
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
    const open = openReaders(readers);
    const settled = (readers?.length ?? 0) - open;
    return settled ? `${plural(open, 'reader')} · ${settled} probably updated` : plural(open, 'reader');
}

function ColumnGroup({ table, column, open, onToggle, bridge }: { table: string; column: ImpactColumn; open: boolean; onToggle: () => void; bridge: Bridge }) {
    return (
        <tbody className="ln-group">
            <tr className="ln-group-row">
                <th scope="rowgroup" colSpan={3}>
                    <div className="ln-group-head">
                        <button type="button" className="ln-group-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${column.column}`} onClick={onToggle}>
                            <span className="ln-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                        </button>
                        <span className="ln-impact-col">{column.column}</span>
                        <span className="ln-chip ln-chip-warn">{describeChange(column.change)}</span>
                        <span className="ln-group-meta">{column.readersError ? 'readers unknown' : readerCount(column.readers)}</span>
                        <span className="ln-grow" />
                        <button type="button" className="ln-link" onClick={() => bridge.post({ type: 'traceImpactColumn', table, column: column.column })}>Trace</button>
                    </div>
                </th>
            </tr>
            {open && <ReaderRows readers={column.readers} error={column.readersError} bridge={bridge} />}
        </tbody>
    );
}

function AtRiskTable({ entry, bridge }: { entry: ImpactTable; bridge: Bridge }) {
    const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
    const startsOpen = entry.columns.length <= OPEN_UP_TO;
    const isOpen = (column: string) => toggled.get(column) ?? startsOpen;
    const toggle = (column: string) => setToggled((current) => new Map(current).set(column, !isOpen(column)));
    return (
        <section className="ln-list-section">
            <h2 className="ln-list-heading ln-impact-table">
                <TableLink table={entry.table} fileName={entry.fileName} bridge={bridge} />
                <span className="ln-list-count">
                    {entry.deleted
                        ? <>deleted on this branch · {entry.readersError ? 'readers unknown' : readerCount(entry.readers)}</>
                        : plural(entry.columns.length, 'dropped or retyped column')}
                </span>
            </h2>
            <div className="ln-table-wrap">
                <table className="ln-table-list ln-impact-list">
                    <thead><tr><th>Reader</th><th>Link</th><th>On this branch</th></tr></thead>
                    {entry.deleted
                        ? <tbody><ReaderRows readers={entry.readers ?? []} error={entry.readersError} bridge={bridge} wholeTable /></tbody>
                        : entry.columns.map((column) => (
                            <ColumnGroup key={column.column} table={entry.table} column={column} open={isOpen(column.column)} onToggle={() => toggle(column.column)} bridge={bridge} />
                        ))}
                </table>
            </div>
        </section>
    );
}

function Header({ impact, bridge, now }: { impact: ImpactView; bridge: Bridge; now: number }) {
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
                {impact.status === 'ready' && !impact.message && (
                    <button type="button" className="ln-button" onClick={() => bridge.post({ type: 'copyImpactMarkdown' })}>Copy as Markdown</button>
                )}
                {running
                    ? <button type="button" className="ln-button" onClick={() => bridge.post({ type: 'cancelImpact' })}>Cancel</button>
                    : <button type="button" className="ln-button" onClick={() => bridge.post({ type: 'refreshImpact' })}>{impact.status === 'ready' ? 'Check again' : 'Run again'}</button>}
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
    return (
        <div className="ln-stack">
            <Header impact={impact} bridge={bridge} now={now} />
            {ready && (
                <div className="ln-list">
                    {impact.atRisk.length === 0 && (
                        <div className="ln-banner" role="note">
                            <strong>Nothing at risk.</strong> No changed table drops or retypes a column against prod, and no table is deleted.
                        </div>
                    )}
                    {impact.atRisk.map((entry) => <AtRiskTable key={entry.table} entry={entry} bridge={bridge} />)}
                    {impact.safe.length > 0 && (
                        <details className="ln-impact-more" open>
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
                        <details className="ln-impact-more" open>
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
