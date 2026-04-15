import { useEffect, useState, useMemo, useRef } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { vscode } from './vscode';
import { ModelInfo, DependencyRow, ModelResult } from './types';
import { DataTable } from '../components/ui/data-table';
import StyledSelect, { OptionType } from '../dependancy_graph/components/StyledSelect';
import { FindWidget } from '../components/FindWidget';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hl(text: string, search: string): React.ReactNode {
    if (!search.trim()) { return text; }
    const parts = text.split(new RegExp(`(${escapeRegex(search)})`, 'gi'));
    if (parts.length === 1) { return text; }
    return (
        <>
            {parts.map((part, i) =>
                part.toLowerCase() === search.toLowerCase()
                    ? <mark key={i} className="search-match" style={{ background: 'var(--vscode-editor-findMatchHighlightBackground)', color: 'inherit', borderRadius: '2px' }}>{part}</mark>
                    : part
            )}
        </>
    );
}

function StatusBadge({ status }: { status: ModelResult['status'] }) {
    if (status === 'idle') { return null; }

    const styles: Record<string, string> = {
        'dry-run-loading': 'bg-[var(--vscode-progressBar-background)] text-[var(--vscode-editor-background)]',
        'query-loading': 'bg-[var(--vscode-progressBar-background)] text-[var(--vscode-editor-background)]',
        'dry-run-success': 'bg-[var(--vscode-testing-iconPassed)] text-[var(--vscode-editor-background)]',
        'query-success': 'bg-[var(--vscode-testing-iconPassed)] text-[var(--vscode-editor-background)]',
        'dry-run-error': 'bg-[var(--vscode-testing-iconFailed)] text-[var(--vscode-editor-background)]',
        'query-error': 'bg-[var(--vscode-testing-iconFailed)] text-[var(--vscode-editor-background)]',
    };

    const labels: Record<string, string> = {
        'dry-run-loading': 'Dry running…',
        'query-loading': 'Running…',
        'dry-run-success': 'Dry run OK',
        'query-success': 'Done',
        'dry-run-error': 'Dry run error',
        'query-error': 'Error',
    };

    return (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? ''}`}>
            {labels[status] ?? status}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────

export default function App() {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [selectedOption, setSelectedOption] = useState<OptionType | null>(null);
    const [fetchingDeps, setFetchingDeps] = useState(false);
    const [dependencies, setDependencies] = useState<DependencyRow[]>([]);
    const [results, setResults] = useState<Record<string, ModelResult>>({});
    const [globalFilter, setGlobalFilter] = useState('');
    const [applyToAll, setApplyToAll] = useState(true);
    const [initError, setInitError] = useState<string | null>(null);
    const [compiling, setCompiling] = useState(false);
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    // Find-in-page
    const [showSearch, setShowSearch] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [matchCount, setMatchCount] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const toggleCard = (id: string) =>
        setExpandedCards(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    // Keep refs so stale closures in message handlers always read latest values
    const dependenciesRef = useRef<DependencyRow[]>([]);
    dependenciesRef.current = dependencies;
    const globalFilterRef = useRef('');
    globalFilterRef.current = globalFilter;
    const applyToAllRef = useRef(true);
    applyToAllRef.current = applyToAll;

    // Dark mode observer (consistent with other webviews)
    useEffect(() => {
        const observer = new MutationObserver(() => {
            const isDark =
                document.body.classList.contains('vscode-dark') ||
                document.body.classList.contains('vscode-high-contrast');
            document.documentElement.classList.toggle('dark', isDark);
        });
        observer.observe(document.body, { attributes: true });
        const isDark =
            document.body.classList.contains('vscode-dark') ||
            document.body.classList.contains('vscode-high-contrast');
        document.documentElement.classList.toggle('dark', isDark);
        return () => observer.disconnect();
    }, []);

    // Cmd/Ctrl+F → open find; Escape → close
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                setShowSearch(true);
                setTimeout(() => searchInputRef.current?.focus(), 0);
            }
            if (e.key === 'Escape' && showSearch) {
                setShowSearch(false);
                setSearchTerm('');
                setCurrentMatchIndex(0);
                setMatchCount(0);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showSearch]);

    // Highlight current match
    useEffect(() => {
        document.querySelectorAll('.search-match-current').forEach(el => {
            (el as HTMLElement).style.background = 'var(--vscode-editor-findMatchHighlightBackground)';
            el.classList.remove('search-match-current');
        });
        if (!searchTerm.trim()) { setMatchCount(0); return; }
        const matches = document.querySelectorAll<HTMLElement>('.search-match');
        setMatchCount(matches.length);
        if (!matches.length) { return; }
        const idx = ((currentMatchIndex % matches.length) + matches.length) % matches.length;
        const cur = matches[idx];
        cur.classList.add('search-match-current');
        cur.style.background = 'var(--vscode-editor-findMatchBackground, #f6931a)';
        cur.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [searchTerm, currentMatchIndex, dependencies, results]);

    useEffect(() => { setCurrentMatchIndex(0); }, [searchTerm]);

    // Message handler from extension host
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data;
            switch (msg.type) {
                case 'compiling':
                    setCompiling(msg.value === true);
                    break;

                case 'models': {
                    const modelList: ModelInfo[] = msg.value ?? [];
                    setModels(modelList);
                    setInitError(null);
                    setCompiling(false);
                    // Auto-select the model the panel was opened from
                    if (msg.initialModelId) {
                        const matched = modelList.find(m => m.fullId === msg.initialModelId);
                        if (matched) {
                            const opt: OptionType = {
                                value: matched.fullId,
                                label: `${matched.name} (${matched.type}) — ${matched.fullId}`,
                            };
                            setSelectedOption(opt);
                            // Auto-fetch dependencies immediately
                            setFetchingDeps(true);
                            setDependencies([]);
                            setResults({});
                            vscode.postMessage({
                                command: 'fetchDependencies',
                                value: { modelFullId: matched.fullId, includeModel: true },
                            });
                        }
                    }
                    break;
                }

                case 'dependencies': {
                    setFetchingDeps(false);
                    const currentFilter = globalFilterRef.current;
                    const depRows: DependencyRow[] = (msg.value ?? []).map((m: ModelInfo) => ({
                        id: m.fullId,
                        fullTableId: m.fullId,
                        filterCondition: currentFilter,
                        enabled: true,
                    }));
                    // Prepend the selected model itself as the first row
                    if (msg.selectedModelId) {
                        depRows.unshift({
                            id: msg.selectedModelId,
                            fullTableId: msg.selectedModelId,
                            filterCondition: currentFilter,
                            enabled: true,
                            isSelectedModel: true,
                        } as DependencyRow);
                    }
                    setDependencies(depRows);
                    setResults({});
                    break;
                }

                case 'dryRunResult': {
                    const { tableId, bytes, cost, error, query } = msg.value;
                    setResults(prev => ({
                        ...prev,
                        [tableId]: {
                            status: error ? 'dry-run-error' : 'dry-run-success',
                            query,
                            bytes,
                            cost,
                            error,
                        },
                    }));
                    setExpandedCards(prev => new Set(prev).add(tableId));
                    break;
                }

                case 'queryLoading': {
                    const { tableId } = msg.value;
                    setResults(prev => ({
                        ...prev,
                        [tableId]: { ...prev[tableId], status: 'query-loading' },
                    }));
                    break;
                }

                case 'queryResult': {
                    const { tableId, results: rows, columns, jobStats, errorMessage, error, query } = msg.value;
                    setResults(prev => ({
                        ...prev,
                        [tableId]: {
                            status: (errorMessage || error) ? 'query-error' : 'query-success',
                            query,
                            results: rows,
                            columns,
                            jobStats,
                            error: errorMessage || error,
                        },
                    }));
                    setExpandedCards(prev => new Set(prev).add(tableId));
                    break;
                }

                case 'error':
                    setInitError(msg.value);
                    break;
            }
        };
        window.addEventListener('message', handler);
        vscode.postMessage({ command: 'appLoaded' });
        return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync globalFilter → all rows when applyToAll is on
    useEffect(() => {
        if (applyToAll && dependencies.length > 0) {
            setDependencies(deps => deps.map(d => ({ ...d, filterCondition: globalFilter })));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [globalFilter, applyToAll]);

    const modelOptions = useMemo<OptionType[]>(
        () => models.map(m => ({
            value: m.fullId,
            label: `${m.name} (${m.type}) — ${m.fullId}`,
        })),
        [models]
    );

    const handleFetchDependencies = () => {
        if (!selectedOption?.value) { return; }
        setFetchingDeps(true);
        setDependencies([]);
        setResults({});
        vscode.postMessage({
            command: 'fetchDependencies',
            value: { modelFullId: selectedOption.value, includeModel: true },
        });
    };

    const handleDryRun = (tableId: string) => {
        const row = dependenciesRef.current.find(d => d.id === tableId);
        const filter = row?.filterCondition ?? '';
        setResults(prev => ({ ...prev, [tableId]: { status: 'dry-run-loading' } }));
        vscode.postMessage({ command: 'dryRun', value: { tableId, filter } });
    };

    const handleRunQuery = (tableId: string) => {
        const row = dependenciesRef.current.find(d => d.id === tableId);
        const filter = row?.filterCondition ?? '';
        setResults(prev => ({ ...prev, [tableId]: { ...prev[tableId], status: 'query-loading' } }));
        vscode.postMessage({ command: 'runQuery', value: { tableId, filter } });
    };

    const handleDryRunAll = () => {
        dependencies.filter(d => d.enabled).forEach(d => handleDryRun(d.id));
    };

    const handleRunAll = () => {
        dependencies.filter(d => d.enabled).forEach(d => handleRunQuery(d.id));
    };

    const toggleRow = (id: string) => {
        setDependencies(deps =>
            deps.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d)
        );
    };

    const allEnabled = dependencies.length > 0 && dependencies.every(d => d.enabled);
    const someEnabled = dependencies.some(d => d.enabled);

    const toggleAll = () => {
        const next = !allEnabled;
        setDependencies(deps => deps.map(d => ({ ...d, enabled: next })));
    };

    const updateFilterForRow = (id: string, value: string) => {
        setDependencies(deps =>
            deps.map(d => d.id === id ? { ...d, filterCondition: value } : d)
        );
    };

    // Models that have results to show
    const modelsWithResults = useMemo(
        () => dependencies.filter(d => results[d.id] && results[d.id].status !== 'idle'),
        [dependencies, results]
    );

    // DataTable columns for query results
    const buildResultColumns = (columns: any[]): ColumnDef<any, any>[] => {
        const base = columns.map(col => ({
            accessorKey: col.field,
            header: () => hl(col.title, searchTerm),
            cell: ({ row }: any) => {
                const val = row.getValue(col.field);
                const text = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
                return hl(text, searchTerm);
            },
        }));
        return [
            {
                id: 'rowIndex',
                header: '',
                size: 60,
                cell: ({ row }: any) => (
                    <span className="text-[var(--vscode-descriptionForeground)] font-mono text-xs">
                        {row.depth > 0 ? '' : Number(row.id) + 1}
                    </span>
                ),
            },
            ...base,
        ];
    };

    return (
        <div className="flex flex-col min-h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] p-4 font-sans gap-4">

            {/* ── Title ── */}
            <h1 className="text-lg font-semibold text-[var(--vscode-foreground)]">Dependency Inspector</h1>

            {showSearch && (
                <FindWidget
                    searchInputRef={searchInputRef}
                    searchTerm={searchTerm}
                    matchCount={matchCount}
                    currentMatchIndex={currentMatchIndex}
                    onSearchTermChange={setSearchTerm}
                    onClose={() => { setShowSearch(false); setSearchTerm(''); setCurrentMatchIndex(0); setMatchCount(0); }}
                    onNextMatch={() => setCurrentMatchIndex(i => i + 1)}
                    onPrevMatch={() => setCurrentMatchIndex(i => i - 1)}
                />
            )}

            {initError && (
                <div className="p-3 rounded border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] text-sm">
                    {initError}
                </div>
            )}

            {/* ── Compilation in progress ── */}
            {compiling && (
                <div className="flex items-center gap-2 text-sm text-[var(--vscode-descriptionForeground)] animate-pulse">
                    <span>⏳</span>
                    <span>Compiling Dataform project…</span>
                </div>
            )}

            {/* ── Model selector ── */}
            <div className="flex items-center gap-3 flex-wrap">
                <label className="text-sm font-medium text-[var(--vscode-foreground)]">Model</label>
                <div className="flex-1 min-w-[400px]">
                    <StyledSelect
                        options={modelOptions}
                        value={selectedOption}
                        onChange={opt => setSelectedOption(opt as OptionType | null)}
                        placeholder="Search or select a model…"
                        isClearable
                        width="w-full"
                    />
                </div>
                <button
                    onClick={handleFetchDependencies}
                    disabled={!selectedOption || fetchingDeps}
                    className="px-4 py-1.5 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded text-sm font-medium disabled:opacity-50 transition-colors"
                >
                    {fetchingDeps ? 'Fetching…' : 'Fetch Dependencies'}
                </button>
            </div>

            {/* ── Global filter ── */}
            <div className="rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <input
                        id="applyToAll"
                        type="checkbox"
                        checked={applyToAll}
                        onChange={e => setApplyToAll(e.target.checked)}
                        className="accent-[var(--vscode-checkbox-background)]"
                    />
                    <label htmlFor="applyToAll" className="text-sm cursor-pointer select-none">
                        Apply filter to all dependencies
                    </label>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--vscode-foreground)] whitespace-nowrap">Filter condition</span>
                    <input
                        type="text"
                        value={globalFilter}
                        onChange={e => setGlobalFilter(e.target.value)}
                        placeholder='e.g. id = "xx" or created_date >= "2024-01-01"'
                        className="flex-1 px-3 py-1.5 text-sm bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] rounded outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] placeholder:text-[var(--vscode-input-placeholderForeground)] font-mono"
                    />
                </div>
            </div>

            {/* ── Dependencies table ── */}
            {dependencies.length > 0 && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-[var(--vscode-foreground)]">
                            Model + Dependencies ({dependencies.length})
                        </h2>
                        <div className="flex gap-2">
                            <button
                                onClick={handleDryRunAll}
                                className="px-3 py-1 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded font-medium transition-colors"
                            >
                                Dry Run All
                            </button>
                            <button
                                onClick={handleRunAll}
                                disabled={dependencies.filter(d => d.enabled).some(d => !d.filterCondition.trim())}
                                title={dependencies.filter(d => d.enabled).some(d => !d.filterCondition.trim()) ? 'Add a filter condition to all enabled rows before running queries' : undefined}
                                className="px-3 py-1 text-xs bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Run All
                            </button>
                            <button
                                onClick={() => setResults({})}
                                disabled={Object.keys(results).length === 0}
                                className="px-3 py-1 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded font-medium transition-colors disabled:opacity-40"
                            >
                                Clear Results
                            </button>
                        </div>
                    </div>

                    {/* Custom table — needs editable inputs + action buttons per row */}
                    <div className="rounded border border-[var(--vscode-widget-border)] overflow-x-auto">
                        <table className="w-full text-sm text-left text-[var(--vscode-foreground)] border-separate border-spacing-0">
                            <thead className="text-xs uppercase bg-[var(--vscode-sideBarSectionHeader-background)]">
                                <tr>
                                    <th className="px-3 py-3 border-b border-[var(--vscode-widget-border)] w-8">
                                        <input
                                            type="checkbox"
                                            checked={allEnabled}
                                            ref={el => { if (el) { el.indeterminate = !allEnabled && someEnabled; } }}
                                            onChange={toggleAll}
                                            className="accent-[var(--vscode-checkbox-background)] cursor-pointer"
                                            title="Select / deselect all"
                                        />
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[35%]">
                                        Full Table ID
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[35%]">
                                        Filter Condition
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[20%]">
                                        Actions
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[10%]">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--vscode-widget-border)]">
                                {dependencies.map(row => {
                                    const res = results[row.id];
                                    const isLoading =
                                        res?.status === 'dry-run-loading' || res?.status === 'query-loading';
                                    return (
                                        <tr
                                            key={row.id}
                                            className={`hover:bg-[var(--vscode-list-hoverBackground)] transition-opacity ${!row.enabled ? 'opacity-40' : ''} ${row.isSelectedModel ? 'bg-[var(--vscode-textBlockQuote-background)]' : 'bg-[var(--vscode-editor-background)]'}`}
                                        >
                                            {/* Checkbox */}
                                            <td className="px-3 py-2 align-middle">
                                                <input
                                                    type="checkbox"
                                                    checked={row.enabled}
                                                    onChange={() => toggleRow(row.id)}
                                                    className="accent-[var(--vscode-checkbox-background)] cursor-pointer"
                                                />
                                            </td>

                                            {/* Full Table ID */}
                                            <td className="px-4 py-2 align-middle">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-xs break-all">{hl(row.fullTableId, searchTerm)}</span>
                                                    {row.isSelectedModel && (
                                                        <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded font-medium bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
                                                            model
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Filter Condition */}
                                            <td className="px-4 py-2 align-middle">
                                                <input
                                                    type="text"
                                                    value={row.filterCondition}
                                                    onChange={e => {
                                                        if (applyToAll) { return; }
                                                        updateFilterForRow(row.id, e.target.value);
                                                    }}
                                                    readOnly={applyToAll}
                                                    placeholder="no filter (full table scan)"
                                                    className={`w-full px-2 py-1 text-xs font-mono bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] rounded outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] placeholder:text-[var(--vscode-input-placeholderForeground)] ${applyToAll ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                />
                                            </td>

                                            {/* Actions */}
                                            <td className="px-4 py-2 align-middle">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => handleDryRun(row.id)}
                                                            disabled={isLoading || !row.enabled}
                                                            className="px-2 py-1 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded font-medium disabled:opacity-50 transition-colors whitespace-nowrap"
                                                        >
                                                            Dry Run
                                                        </button>
                                                        <button
                                                            onClick={() => handleRunQuery(row.id)}
                                                            disabled={isLoading || !row.enabled || !row.filterCondition.trim()}
                                                            title={!row.filterCondition.trim() ? 'Add a filter condition to avoid a full table scan' : undefined}
                                                            className="px-2 py-1 text-xs bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                                                        >
                                                            Run Query
                                                        </button>
                                                    </div>
                                                    {!row.filterCondition.trim() && row.enabled && (
                                                        <p className="text-[10px] text-[var(--vscode-inputValidation-warningForeground)] leading-tight">
                                                            Filter required to run query
                                                        </p>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Status */}
                                            <td className="px-4 py-2 align-middle">
                                                {res && <StatusBadge status={res.status} />}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Per-model result cards ── */}
            {modelsWithResults.length > 0 && (
                <div className="flex flex-col gap-4">
                    <h2 className="text-sm font-semibold text-[var(--vscode-foreground)]">Results</h2>
                    {modelsWithResults.map(dep => {
                        const res = results[dep.id];
                        if (!res || res.status === 'idle') { return null; }

                        const isLoading = res.status === 'dry-run-loading' || res.status === 'query-loading';
                        const isDryRun = res.status === 'dry-run-success' || res.status === 'dry-run-error' || res.status === 'dry-run-loading';

                        const resultColumns = res.columns
                            ? buildResultColumns(res.columns)
                            : [];

                        const isCollapsed = !expandedCards.has(dep.id);

                        // Compute BQ link once so it's available in both header and body
                        const jobId: string | undefined = res.jobStats?.bigQueryJobId;
                        let bqLink: string | undefined;
                        if (jobId) {
                            const parts = jobId.split(':');
                            if (parts.length >= 2) {
                                const projectId = parts[0];
                                const restId = parts[1].replace('.', ':');
                                bqLink = `https://console.cloud.google.com/bigquery?project=${projectId}&j=bq:${restId}&page=queryresults`;
                            }
                        }

                        return (
                            <div
                                key={dep.id}
                                className="rounded border border-[var(--vscode-widget-border)] overflow-hidden"
                            >
                                {/* ── Card header (always visible, clickable to collapse) ── */}
                                <div
                                    className="flex flex-col gap-1 px-4 py-2 bg-[var(--vscode-sideBarSectionHeader-background)] border-b border-[var(--vscode-widget-border)] cursor-pointer select-none"
                                    onClick={() => toggleCard(dep.id)}
                                >
                                    {/* Top row: table ID + collapse chevron + status */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-[var(--vscode-descriptionForeground)] text-xs shrink-0">
                                                {isCollapsed ? '▶' : '▼'}
                                            </span>
                                            <span className="font-mono text-xs font-semibold truncate">{hl(dep.fullTableId, searchTerm)}</span>
                                        </div>
                                        <StatusBadge status={res.status} />
                                    </div>

                                    {/* Job meta row — always shown even when collapsed */}
                                    {res.jobStats && (
                                        <div
                                            className="flex items-center gap-2 flex-wrap text-xs font-mono text-[var(--vscode-descriptionForeground)]"
                                            onClick={e => e.stopPropagation()}
                                        >
                                            <span>
                                                {res.jobStats.bigQueryJobEndTime ? `Ran at: ${res.jobStats.bigQueryJobEndTime}` : ''}
                                                {res.jobStats.jobCostMeta ? ` | Billed: ${res.jobStats.jobCostMeta}` : ''}
                                                {jobId ? ` | Job: ${jobId}` : ''}
                                            </span>
                                            {bqLink && (
                                                <>
                                                    <span className="opacity-40">|</span>
                                                    <button
                                                        onClick={() => vscode.postMessage({ command: 'openExternal', value: bqLink })}
                                                        className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] hover:underline bg-transparent border-none p-0 cursor-pointer font-sans"
                                                    >
                                                        View job in BigQuery ↗
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* ── Collapsible body ── */}
                                {!isCollapsed && (
                                    <div className="p-3 flex flex-col gap-3 bg-[var(--vscode-editor-background)]">

                                        {/* Query */}
                                        {res.query && (
                                            <div>
                                                <p className="text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1 uppercase tracking-wide">Query</p>
                                                <pre className="text-xs font-mono bg-[var(--vscode-textBlockQuote-background)] border border-[var(--vscode-textBlockQuote-border)] rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all text-[var(--vscode-editor-foreground)]">
                                                    {res.query}
                                                </pre>
                                            </div>
                                        )}

                                        {/* Loading */}
                                        {isLoading && (
                                            <p className="text-xs text-[var(--vscode-descriptionForeground)] animate-pulse">
                                                {isDryRun ? 'Running dry run…' : 'Executing query…'}
                                            </p>
                                        )}

                                        {/* Error */}
                                        {res.error && (
                                            <div className="rounded border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] px-3 py-2">
                                                <p className="text-xs font-medium text-[var(--vscode-inputValidation-errorForeground)] mb-1">Error</p>
                                                <pre className="text-xs font-mono text-[var(--vscode-inputValidation-errorForeground)] whitespace-pre-wrap">{res.error}</pre>
                                            </div>
                                        )}

                                        {/* Dry run stats */}
                                        {res.status === 'dry-run-success' && (
                                            <div className="flex gap-4 text-xs text-[var(--vscode-foreground)]">
                                                {res.bytes && (
                                                    <span>
                                                        <span className="text-[var(--vscode-descriptionForeground)]">Bytes processed: </span>
                                                        <span className="font-mono font-semibold">{res.bytes}</span>
                                                    </span>
                                                )}
                                                {res.cost && (
                                                    <span>
                                                        <span className="text-[var(--vscode-descriptionForeground)]">Estimated cost: </span>
                                                        <span className="font-mono font-semibold">{res.cost}</span>
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Results table */}
                                        {res.status === 'query-success' && res.results && resultColumns.length > 0 && (
                                            <div>
                                                <p className="text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1 uppercase tracking-wide">
                                                    Results ({res.results.length} row{res.results.length !== 1 ? 's' : ''})
                                                </p>
                                                <div className="max-h-72 overflow-auto">
                                                    <DataTable columns={resultColumns} data={res.results} />
                                                </div>
                                            </div>
                                        )}

                                        {res.status === 'query-success' && (!res.results || res.results.length === 0) && !res.error && (
                                            <p className="text-xs text-[var(--vscode-extensionIcon-preReleaseForeground)] font-medium">
                                                No rows returned — condition not matched in this table.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Empty state */}
            {models.length === 0 && !initError && (
                <p className="text-sm text-[var(--vscode-descriptionForeground)]">
                    Loading models… (save a <code>.sqlx</code> file to trigger compilation if the list is empty)
                </p>
            )}
        </div>
    );
}
