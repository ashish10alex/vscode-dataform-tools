import { KeyboardEvent, RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ColumnEntry, ColumnsView } from '../../src/shared/columnLineage/types';
import { readerTotal } from '../../src/shared/columnLineage/impactRules';
import type { Bridge } from './bridge';

function changeLabel(entry: ColumnEntry): string | undefined {
    if (!entry.change) {
        return undefined;
    }
    return entry.change.kind === 'dropped' ? 'dropped' : `${entry.change.from} → ${entry.change.to}`;
}

function readerText(entry: ColumnEntry): string {
    if (entry.countsError) {
        return 'lineage unavailable';
    }
    if (!entry.counts) {
        return '…';
    }
    const total = readerTotal(entry.counts);
    return `${total} reader${total === 1 ? '' : 's'}`;
}

function readerBreakdown(entry: ColumnEntry): string | undefined {
    if (entry.countsError) {
        return `Couldn’t read lineage: ${entry.countsError}`;
    }
    if (!entry.counts) {
        return undefined;
    }
    const { copies, derived, mayRead } = entry.counts;
    return `${copies} cop${copies === 1 ? 'y' : 'ies'} · ${derived} derived or filtered · ${mayRead} may read (Dataplex)`;
}

/**
 * Changed columns as chips, wrapped to two rows. Chips that don't fit are clipped, and a "+N more" chip opens the
 * search on the changed columns.
 */
function ChangedChips({ entries, selected, bridge, onMore }: { entries: ColumnEntry[]; selected?: string; bridge: Bridge; onMore: () => void }) {
    const wrap = useRef<HTMLDivElement>(null);
    const [hidden, setHidden] = useState(0);

    useLayoutEffect(() => {
        const element = wrap.current;
        if (!element) {
            return;
        }
        const measure = () => {
            const chips = Array.from(element.children) as HTMLElement[];
            setHidden(chips.filter((chip) => chip.offsetTop >= element.clientHeight).length);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [entries]);

    return (
        <div className="ln-chips-row">
            <div className="ln-chips" ref={wrap}>
                {entries.map((entry) => {
                    const isSelected = entry.column === selected;
                    const unread = !!entry.counts && readerTotal(entry.counts) === 0;
                    return (
                        <button
                            key={entry.column}
                            type="button"
                            className={`ln-col-chip ${isSelected ? 'is-selected' : ''} ${unread ? 'is-unread' : ''}`}
                            aria-pressed={isSelected}
                            title={readerBreakdown(entry)}
                            onClick={() => bridge.post({ type: 'selectColumn', column: entry.column })}
                        >
                            <span className="ln-col-chip-name">{entry.column}</span>
                            <span className="ln-col-chip-change">{changeLabel(entry)}</span>
                            <span className="ln-col-chip-readers">{readerText(entry)}</span>
                        </button>
                    );
                })}
            </div>
            {hidden > 0 && (
                <button type="button" className="ln-col-chip ln-col-chip-more" onClick={onMore}>+{hidden} more</button>
            )}
        </div>
    );
}

function matches(entry: ColumnEntry, words: string[]): boolean {
    const text = `${entry.column} ${entry.type ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
}

/** Search over every column: changed first, then prod's schema order, then new columns, which can't be picked */
function ColumnSearch({ columns, bridge, inputRef, onlyChanged, setOnlyChanged }: {
    columns: ColumnsView;
    bridge: Bridge;
    inputRef: RefObject<HTMLInputElement | null>;
    onlyChanged: boolean;
    setOnlyChanged: (on: boolean) => void;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const list = useRef<HTMLUListElement>(null);

    const shown = useMemo(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return columns.entries.filter((entry) => (!onlyChanged || entry.change) && matches(entry, words));
    }, [columns.entries, onlyChanged, query]);
    const pickable = shown.filter((entry) => !entry.isNew);

    useEffect(() => setActive(0), [query, onlyChanged, open]);
    useEffect(() => {
        list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    const close = () => {
        setOpen(false);
        setQuery('');
        setOnlyChanged(false);
    };
    const pick = (entry: ColumnEntry | undefined) => {
        if (entry && !entry.isNew) {
            bridge.post({ type: 'selectColumn', column: entry.column });
            close();
            inputRef.current?.blur();
        }
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((index) => (pickable.length ? (index + step + pickable.length) % pickable.length : 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            pick(pickable[active]);
        } else if (event.key === 'Escape') {
            close();
            inputRef.current?.blur();
        }
    };

    const traceable = columns.entries.filter((entry) => !entry.isNew).length;
    const activeColumn = pickable[active]?.column;
    const optionId = (column: string) => `ln-col-option-${column}`;

    return (
        <div className="ln-search">
            <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-controls="ln-col-options"
                aria-autocomplete="list"
                aria-activedescendant={open && activeColumn ? optionId(activeColumn) : undefined}
                aria-label="Search columns"
                placeholder={`${columns.selected ?? 'Column'} · search ${traceable} column${traceable === 1 ? '' : 's'}…`}
                value={query}
                onFocus={() => setOpen(true)}
                onBlur={close}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setOpen(true);
                }}
                onKeyDown={onKeyDown}
            />
            {open && (
                <ul className="ln-search-list" id="ln-col-options" role="listbox" ref={list} aria-label="Columns">
                    {onlyChanged && <li className="ln-search-note" role="presentation">Changed against prod</li>}
                    {shown.map((entry) => (
                        <li
                            key={entry.column}
                            id={optionId(entry.column)}
                            role="option"
                            aria-selected={entry.column === columns.selected}
                            aria-disabled={entry.isNew}
                            className={`ln-search-option ${entry.column === activeColumn ? 'is-active' : ''} ${entry.isNew ? 'is-new' : ''}`}
                            // Keep focus in the input, so the blur doesn't close the list before the pick
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => pick(entry)}
                            title={entry.isNew ? 'Only on this branch, so there is no prod lineage yet' : readerBreakdown(entry)}
                        >
                            <span className="ln-search-check" aria-hidden="true">{entry.column === columns.selected ? '✓' : ''}</span>
                            <span className="ln-search-col">{entry.column}</span>
                            {entry.type && <span className="ln-search-type">{entry.type}</span>}
                            {entry.change && <span className="ln-chip ln-chip-warn">{changeLabel(entry)}</span>}
                            {entry.isNew && <span className="ln-chip">new</span>}
                            {entry.change && <span className="ln-search-readers">{readerText(entry)}</span>}
                        </li>
                    ))}
                    {shown.length === 0 && <li className="ln-search-note" role="presentation">No columns match.</li>}
                </ul>
            )}
        </div>
    );
}

function formatChecked(checkedAt: number | undefined, now: number): string | undefined {
    if (!checkedAt) {
        return undefined;
    }
    const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
    if (seconds < 10) {
        return 'checked just now';
    }
    return seconds < 90 ? `checked ${seconds} s ago` : `checked ${Math.round(seconds / 60)} min ago`;
}

/** The column picker above the trace: the table, its changed columns, new ones, and a search over all of them */
export function ColumnBar({ columns, bridge, now }: { columns: ColumnsView; bridge: Bridge; now: number }) {
    const input = useRef<HTMLInputElement>(null);
    const [onlyChanged, setOnlyChanged] = useState(false);
    const table = columns.table?.split('.').slice(1).join('.');
    const changed = columns.entries.filter((entry) => entry.change);
    const added = columns.entries.filter((entry) => entry.isNew);
    const ready = columns.status === 'ready';

    let status: string | undefined;
    if (columns.status === 'loading') {
        status = 'Reading columns and comparing with prod…';
    } else if (columns.status === 'error' || columns.message) {
        status = columns.message;
    } else if (columns.unchecked) {
        status = 'Not checked against prod: no dry run of this file yet. Save the file or refresh the compiled query panel.';
    } else if (changed.length === 0) {
        status = 'No columns dropped or retyped against prod.';
    }

    return (
        <section className="ln-bar" aria-label="Columns">
            <div className="ln-bar-head">
                <span className="ln-eyebrow">Columns</span>
                {table && <span className="ln-bar-table" title={columns.table}>{table}</span>}
                <span className="ln-grow" />
                {columns.status === 'loading'
                    ? <span className="ln-bar-checked"><span className="ln-spinner" aria-hidden="true" /> checking…</span>
                    : <span className="ln-bar-checked">{formatChecked(columns.checkedAt, now)}</span>}
                <button type="button" className="ln-button" disabled={columns.status === 'loading'} onClick={() => bridge.post({ type: 'recheckColumns' })}>
                    Check again
                </button>
            </div>
            {status && (
                <div className={`ln-bar-status ${columns.status === 'error' ? 'ln-side-error' : ''}`} role={columns.status === 'error' ? 'alert' : 'status'}>
                    {status}
                </div>
            )}
            {ready && (
                <div className="ln-bar-lines">
                    {changed.length > 0 && (
                        <div className="ln-bar-line">
                            <span className="ln-bar-label">Changed</span>
                            <ChangedChips
                                entries={changed}
                                selected={columns.selected}
                                bridge={bridge}
                                onMore={() => {
                                    setOnlyChanged(true);
                                    input.current?.focus();
                                }}
                            />
                        </div>
                    )}
                    {added.length > 0 && (
                        <div className="ln-bar-line ln-bar-new">
                            <span className="ln-bar-label">New on this branch</span>
                            <span className="ln-bar-new-list" title={`${added.map((entry) => entry.column).join(', ')}: only on this branch, so no prod lineage yet`}>
                                {added.map((entry) => entry.column).join(', ')}
                            </span>
                        </div>
                    )}
                    {columns.entries.some((entry) => !entry.isNew) && (
                        <div className="ln-bar-line">
                            <span className="ln-bar-label">Column</span>
                            <ColumnSearch columns={columns} bridge={bridge} inputRef={input} onlyChanged={onlyChanged} setOnlyChanged={setOnlyChanged} />
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
