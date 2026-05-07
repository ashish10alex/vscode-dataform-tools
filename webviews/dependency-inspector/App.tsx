import { useEffect, useState, useMemo, useRef } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { vscode } from './vscode';
import { ModelInfo, DependencyRow, DependencyInfo, ModelResult, GraphEdge, SchemaField } from './types';
import { DataTable } from '../components/ui/data-table';
import StyledSelect, { OptionType } from '../dependancy_graph/components/StyledSelect';
import { FindWidget } from '../components/FindWidget';
import DependencyGraph from './DependencyGraph';
import { BigQueryTableLink } from '../components/BigQueryTableLink';
import { AutoGrowingTextarea } from '../components/AutoGrowingTextarea';

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

function flattenSchemaFields(fields: SchemaField[], prefix = ''): SchemaField[] {
    const out: SchemaField[] = [];
    for (const f of fields) {
        const name = prefix ? `${prefix}.${f.name}` : f.name;
        out.push({ name, type: f.type, mode: f.mode, description: f.description });
        if (f.fields && f.fields.length > 0) {
            out.push(...flattenSchemaFields(f.fields, name));
        }
    }
    return out;
}

function buildBqLink(jobId: string | undefined): string | undefined {
    if (!jobId) { return undefined; }
    const parts = jobId.split(':');
    if (parts.length < 2) { return undefined; }
    const projectId = parts[0];
    const restId = parts[1].replace('.', ':');
    return `https://console.cloud.google.com/bigquery?project=${projectId}&j=bq:${restId}&page=queryresults`;
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
// Filter persistence
// ─────────────────────────────────────────────────────────────

interface SavedFilterState {
    globalFilter: string;
    applyToAll: boolean;
    deps: Record<string, { enabled: boolean; filterCondition: string }>;
}

const STORAGE_PREFIX = 'dataform-dep-inspector:';

function loadSavedFilters(modelFullId: string): SavedFilterState | null {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + modelFullId);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveFilters(modelFullId: string, state: SavedFilterState) {
    try {
        localStorage.setItem(STORAGE_PREFIX + modelFullId, JSON.stringify(state));
    } catch { /* quota exceeded — silently skip */ }
}

// ─────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────

export default function App() {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [selectedOption, setSelectedOption] = useState<OptionType | null>(null);
    const [fetchingDeps, setFetchingDeps] = useState(false);
    const [dependencies, setDependencies] = useState<DependencyRow[]>([]);
    const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
    const [results, setResults] = useState<Record<string, ModelResult>>({});
    const [globalFilter, setGlobalFilter] = useState('');
    const [applyToAll, setApplyToAll] = useState(true);
    const [depth, setDepth] = useState(3);
    const [initError, setInitError] = useState<string | null>(null);
    const [compiling, setCompiling] = useState(false);
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<'table' | 'graph'>('table');
    const [filtersRestored, setFiltersRestored] = useState(false);
    const [workspaceFilterStatus, setWorkspaceFilterStatus] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null);
    const [workspaceFilterDescription, setWorkspaceFilterDescription] = useState('');
    const [activePresetId, setActivePresetId] = useState<string | null>(null);

    // Full Table ID column filter
    const [tableIdFilter, setTableIdFilter] = useState('');
    const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);

    // Schema side panel
    const [schemaPanelOpen, setSchemaPanelOpen] = useState(false);
    const [schemaActiveTableId, setSchemaActiveTableId] = useState<string | null>(null);
    const [schemaLoading, setSchemaLoading] = useState(false);
    const [schemaError, setSchemaError] = useState<string | null>(null);
    const [schemaFields, setSchemaFields] = useState<SchemaField[] | null>(null);
    const [schemaCache, setSchemaCache] = useState<Record<string, SchemaField[]>>({});

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
    const selectedOptionRef = useRef<OptionType | null>(null);
    selectedOptionRef.current = selectedOption;
    const globalFilterRef = useRef('');
    globalFilterRef.current = globalFilter;
    const applyToAllRef = useRef(true);
    applyToAllRef.current = applyToAll;
    const depthRef = useRef(3);
    depthRef.current = depth;

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

    useEffect(() => {
        setWorkspaceFilterDescription('');
        setActivePresetId(null);
    }, [selectedOption?.value]);

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
                                value: { modelFullId: matched.fullId, depth: depthRef.current },
                            });
                        }
                    }
                    break;
                }

                case 'dependencies': {
                    setFetchingDeps(false);
                    const currentFilter = globalFilterRef.current;
                    const depRows: DependencyRow[] = (msg.value ?? []).map((m: DependencyInfo) => ({
                        id: m.fullId,
                        fullTableId: m.fullId,
                        filterCondition: currentFilter,
                        enabled: true,
                        depth: m.depth,
                    }));
                    // Prepend the selected model itself as the first row
                    if (msg.selectedModelId) {
                        depRows.unshift({
                            id: msg.selectedModelId,
                            fullTableId: msg.selectedModelId,
                            filterCondition: currentFilter,
                            enabled: true,
                            isSelectedModel: true,
                            depth: 0,
                        });
                    }
                    // Restore saved filter state for this model (if any)
                    const modelId = selectedOptionRef.current?.value;
                    const saved = modelId ? loadSavedFilters(modelId) : null;
                    if (saved) {
                        setGlobalFilter(saved.globalFilter);
                        setApplyToAll(saved.applyToAll);
                        depRows.forEach(row => {
                            const s = saved.deps[row.id];
                            if (s) {
                                row.filterCondition = s.filterCondition;
                                row.enabled = s.enabled;
                            } else {
                                // dep not in saved state: apply globalFilter if applyToAll
                                row.filterCondition = saved.applyToAll ? saved.globalFilter : '';
                            }
                        });
                        setFiltersRestored(true);
                        setTimeout(() => setFiltersRestored(false), 3000);
                    }
                    setDependencies(depRows);
                    setGraphEdges(msg.edges ?? []);
                    setResults({});
                    // Auto-load the most recent workspace preset for this model (if any).
                    // Extension will silently ignore if no presets exist or no workspace.
                    if (modelId) {
                        vscode.postMessage({
                            command: 'getLatestFilterPreset',
                            value: { modelFullId: modelId },
                        });
                    }
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
                    break;
                }

                case 'schema': {
                    const { fullTableId, fields } = msg.value ?? {};
                    if (!fullTableId) { break; }
                    setSchemaCache(prev => ({ ...prev, [fullTableId]: fields }));
                    setSchemaActiveTableId(prevActive => {
                        if (prevActive === fullTableId) {
                            setSchemaFields(fields);
                            setSchemaLoading(false);
                            setSchemaError(null);
                        }
                        return prevActive;
                    });
                    break;
                }

                case 'schemaError': {
                    const { fullTableId, error } = msg.value ?? {};
                    setSchemaActiveTableId(prevActive => {
                        if (prevActive === fullTableId) {
                            setSchemaFields(null);
                            setSchemaLoading(false);
                            setSchemaError(error || 'Failed to fetch schema');
                        }
                        return prevActive;
                    });
                    break;
                }

                case 'filtersSavedToWorkspace': {
                    const { ok, error, path, presetId, overwrote } = msg.value ?? {};
                    if (ok) {
                        if (presetId) { setActivePresetId(presetId); }
                        setWorkspaceFilterStatus({
                            kind: 'success',
                            message: `${overwrote ? 'Updated' : 'Saved new'} preset in ${path}`,
                        });
                    } else {
                        setWorkspaceFilterStatus({ kind: 'error', message: `Failed to save filters: ${error ?? 'unknown error'}` });
                    }
                    setTimeout(() => setWorkspaceFilterStatus(null), 4000);
                    break;
                }

                case 'filterPresetDeleted': {
                    const { modelFullId, presetId } = msg.value ?? {};
                    if (selectedOptionRef.current?.value === modelFullId && presetId) {
                        setActivePresetId(prev => (prev === presetId ? null : prev));
                        setWorkspaceFilterStatus({ kind: 'info', message: 'Preset deleted.' });
                        setTimeout(() => setWorkspaceFilterStatus(null), 3000);
                    }
                    break;
                }

                case 'filtersLoadedFromWorkspace': {
                    const { modelFullId, state, description, error, missing, presetId, auto } = msg.value ?? {};
                    const currentModelId = selectedOptionRef.current?.value;
                    if (!currentModelId || currentModelId !== modelFullId) { break; }
                    if (error) {
                        setWorkspaceFilterStatus({ kind: 'error', message: error });
                        setTimeout(() => setWorkspaceFilterStatus(null), 4000);
                        break;
                    }
                    if (!state) {
                        // Auto-load probe found nothing — stay quiet.
                        if (auto) { break; }
                        setWorkspaceFilterStatus({
                            kind: 'info',
                            message: missing ? 'No saved filters file in workspace.' : 'No saved filters for this model in workspace.',
                        });
                        setTimeout(() => setWorkspaceFilterStatus(null), 4000);
                        break;
                    }
                    setGlobalFilter(state.globalFilter ?? '');
                    setApplyToAll(state.applyToAll ?? true);
                    setDependencies(deps => deps.map(d => {
                        const s = state.deps?.[d.id];
                        if (s) {
                            return { ...d, enabled: s.enabled, filterCondition: s.filterCondition };
                        }
                        return { ...d, filterCondition: state.applyToAll ? (state.globalFilter ?? '') : '' };
                    }));
                    setWorkspaceFilterDescription(typeof description === 'string' ? description : '');
                    setActivePresetId(typeof presetId === 'string' ? presetId : null);
                    const verb = auto ? 'Auto-loaded latest preset' : 'Loaded preset';
                    setWorkspaceFilterStatus({
                        kind: 'success',
                        message: description ? `${verb} — ${description}` : `${verb} from workspace.`,
                    });
                    setTimeout(() => setWorkspaceFilterStatus(null), 4000);
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
    }, []);

    // Sync globalFilter → all rows when applyToAll is on
    useEffect(() => {
        if (applyToAll && dependencies.length > 0) {
            setDependencies(deps => deps.map(d => ({ ...d, filterCondition: globalFilter })));
        }
    }, [globalFilter, applyToAll]);

    // Auto-save filter state per model (debounced 500ms)
    useEffect(() => {
        if (!selectedOption?.value || dependencies.length === 0) { return; }
        const modelId = selectedOption.value;
        const state: SavedFilterState = {
            globalFilter,
            applyToAll,
            deps: Object.fromEntries(
                dependencies.map(d => [d.id, { enabled: d.enabled, filterCondition: d.filterCondition }])
            ),
        };
        const id = setTimeout(() => saveFilters(modelId, state), 500);
        return () => clearTimeout(id);
    }, [dependencies, globalFilter, applyToAll, selectedOption]);

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
            value: { modelFullId: selectedOption.value, depth },
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

    const handleViewSchema = (fullTableId: string) => {
        if (!fullTableId) { return; }
        setSchemaPanelOpen(true);
        setSchemaActiveTableId(fullTableId);
        setSchemaError(null);
        const cached = schemaCache[fullTableId];
        if (cached) {
            setSchemaFields(cached);
            setSchemaLoading(false);
            return;
        }
        setSchemaFields(null);
        setSchemaLoading(true);
        vscode.postMessage({ command: 'getTableSchema', value: { fullTableId } });
    };

    const handleCloseSchema = () => {
        setSchemaPanelOpen(false);
    };

    const handleSaveFiltersToWorkspace = (mode: 'new' | 'overwrite') => {
        if (!selectedOption?.value || dependencies.length === 0) { return; }
        if (mode === 'overwrite' && !activePresetId) { return; }
        const filterState: SavedFilterState = {
            globalFilter,
            applyToAll,
            deps: Object.fromEntries(
                dependencies.map(d => [d.id, { enabled: d.enabled, filterCondition: d.filterCondition }])
            ),
        };
        const description = workspaceFilterDescription.trim();
        vscode.postMessage({
            command: 'saveFiltersToWorkspace',
            value: {
                modelFullId: selectedOption.value,
                filterState,
                description: description || undefined,
                presetId: mode === 'overwrite' ? activePresetId : undefined,
            },
        });
    };

    const handleLoadFiltersFromWorkspace = () => {
        if (!selectedOption?.value) { return; }
        vscode.postMessage({
            command: 'loadFiltersFromWorkspace',
            value: { modelFullId: selectedOption.value },
        });
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

    const visibleDependencies = useMemo(() => {
        const q = tableIdFilter.trim().toLowerCase();
        return dependencies.filter(d => {
            if (showOnlyEnabled && !d.enabled) { return false; }
            if (q && !d.fullTableId.toLowerCase().includes(q)) { return false; }
            return true;
        });
    }, [dependencies, tableIdFilter, showOnlyEnabled]);

    const schemaRows = useMemo(
        () => (schemaFields ? flattenSchemaFields(schemaFields) : []),
        [schemaFields]
    );

    const schemaColumns = useMemo<ColumnDef<SchemaField, any>[]>(() => [
        {
            accessorKey: 'name',
            header: 'Name',
            size: 200,
            cell: ({ row }) => (
                <span
                    className="font-mono text-xs break-all text-[var(--vscode-foreground)]"
                    title={(row.original as SchemaField).description || undefined}
                >
                    {row.original.name}
                </span>
            ),
        },
        {
            accessorKey: 'type',
            header: 'Type',
            size: 110,
            cell: ({ row }) => (
                <span className="font-mono text-xs text-[var(--vscode-descriptionForeground)] whitespace-nowrap">
                    {row.original.type}
                </span>
            ),
        },
    ], []);

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
                        {row.index + 1}
                    </span>
                ),
            },
            ...base,
        ];
    };

    const bulkActions = dependencies.length > 0 ? (
        <div className="flex gap-2 justify-end">
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
    ) : null;

    const schemaAside = schemaPanelOpen ? (
        <aside className="w-[480px] shrink-0 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] flex flex-col h-[70vh]">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBarSectionHeader-background)] shrink-0">
                <div className="min-w-0 flex flex-col">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--vscode-descriptionForeground)]">Schema</span>
                    <span
                        className="font-mono text-xs break-all whitespace-normal text-[var(--vscode-foreground)]"
                        title={schemaActiveTableId ?? ''}
                    >
                        {schemaActiveTableId ?? ''}
                    </span>
                </div>
                <button
                    onClick={handleCloseSchema}
                    aria-label="Close schema panel"
                    title="Close"
                    className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        <line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                </button>
            </div>
            <div className="flex-1 min-h-0 p-2 flex flex-col">
                {schemaLoading && (
                    <p className="text-xs text-[var(--vscode-descriptionForeground)] animate-pulse px-1 py-2">
                        Fetching schema…
                    </p>
                )}
                {schemaError && (
                    <div className="rounded border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] px-2 py-1.5">
                        <p className="text-xs font-mono text-[var(--vscode-inputValidation-errorForeground)] whitespace-pre-wrap break-all">
                            {schemaError}
                        </p>
                    </div>
                )}
                {!schemaLoading && !schemaError && schemaFields && schemaFields.length === 0 && (
                    <p className="text-xs text-[var(--vscode-descriptionForeground)] px-1 py-2">
                        No fields in this table.
                    </p>
                )}
                {!schemaLoading && !schemaError && schemaFields && schemaFields.length > 0 && (
                    <DataTable columns={schemaColumns} data={schemaRows} />
                )}
            </div>
        </aside>
    ) : null;

    return (
        <div className="flex flex-col min-h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] p-4 font-sans gap-4">

            {/* ── Title + Tab Toggle ── */}
            <div className="flex items-center justify-between gap-4">
                <h1 className="text-lg font-semibold text-[var(--vscode-foreground)]">Dependency Inspector</h1>
                {dependencies.length > 0 && (
                    <div className="flex rounded border border-[var(--vscode-widget-border)] overflow-hidden text-xs font-medium shrink-0">
                        <button
                            onClick={() => setActiveTab('table')}
                            className={`px-3 py-1.5 transition-colors ${activeTab === 'table'
                                ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                                : 'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]'}`}
                        >
                            Table
                        </button>
                        <button
                            onClick={() => setActiveTab('graph')}
                            className={`px-3 py-1.5 transition-colors border-l border-[var(--vscode-widget-border)] ${activeTab === 'graph'
                                ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                                : 'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]'}`}
                        >
                            Graph
                        </button>
                    </div>
                )}
            </div>

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
                <div className="flex items-center gap-1.5 shrink-0">
                    <label className="text-xs text-[var(--vscode-foreground)] whitespace-nowrap">Depth</label>
                    <input
                        type="number"
                        min={1}
                        max={20}
                        value={depth}
                        onChange={e => setDepth(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                        className="w-14 px-2 py-1.5 text-sm text-center bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] rounded outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
                        title="Maximum number of dependency levels to load recursively (1–20)"
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
                    <div className="ml-auto flex items-center gap-2">
                        {activePresetId && (
                            <span
                                className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]"
                                title={`Editing preset ${activePresetId}`}
                            >
                                editing #{activePresetId.slice(0, 8)}
                            </span>
                        )}
                        <button
                            onClick={handleLoadFiltersFromWorkspace}
                            disabled={!selectedOption?.value}
                            title="Load a saved preset for this model (also lets you delete presets)"
                            className="px-2.5 py-1 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Load preset…
                        </button>
                        <button
                            onClick={() => handleSaveFiltersToWorkspace('overwrite')}
                            disabled={!selectedOption?.value || dependencies.length === 0 || !activePresetId}
                            title={activePresetId
                                ? `Overwrite the loaded preset (${activePresetId.slice(0, 8)})`
                                : 'Load a preset first to overwrite it'}
                            className="px-2.5 py-1 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Save (overwrite)
                        </button>
                        <button
                            onClick={() => handleSaveFiltersToWorkspace('new')}
                            disabled={!selectedOption?.value || dependencies.length === 0}
                            title="Save current filters as a new preset"
                            className="px-2.5 py-1 text-xs bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Save as new
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--vscode-foreground)] whitespace-nowrap">Filter condition</span>
                    <AutoGrowingTextarea
                        value={globalFilter}
                        onChange={e => setGlobalFilter(e.target.value)}
                        rows={1}
                        placeholder='e.g. id = "xx" or created_date >= "2024-01-01"'
                        className="flex-1 px-3 py-1.5 text-sm bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] rounded outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] placeholder:text-[var(--vscode-input-placeholderForeground)] font-mono resize-none whitespace-pre-wrap break-all overflow-hidden"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--vscode-foreground)] whitespace-nowrap">Description</span>
                    <input
                        type="text"
                        value={workspaceFilterDescription}
                        onChange={e => setWorkspaceFilterDescription(e.target.value)}
                        placeholder="optional — saved alongside workspace filters (e.g. 'QA debug for incident #123')"
                        className="flex-1 px-3 py-1.5 text-sm bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] rounded outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] placeholder:text-[var(--vscode-input-placeholderForeground)]"
                    />
                </div>
            </div>

            {/* ── Filters restored toast ── */}
            {filtersRestored && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--vscode-descriptionForeground)] animate-pulse">
                    <span>✓ Saved filters applied</span>
                </div>
            )}

            {workspaceFilterStatus && (
                <div className={`text-xs px-2 py-1 rounded border ${
                    workspaceFilterStatus.kind === 'success'
                        ? 'border-[var(--vscode-testing-iconPassed)] text-[var(--vscode-testing-iconPassed)]'
                        : workspaceFilterStatus.kind === 'error'
                            ? 'border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)]'
                            : 'border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                }`}>
                    {workspaceFilterStatus.message}
                </div>
            )}

            {/* ── Graph tab ── */}
            {activeTab === 'graph' && dependencies.length > 0 && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-[var(--vscode-foreground)]">
                            Model + Dependencies ({dependencies.length})
                        </h2>
                        {bulkActions}
                    </div>
                    <div className="flex gap-3 items-start">
                        <div className="flex-1 min-w-0">
                            <DependencyGraph
                                dependencies={dependencies}
                                graphEdges={graphEdges}
                                onToggleNode={toggleRow}
                                onViewSchema={handleViewSchema}
                                results={results}
                            />
                        </div>
                        {schemaAside}
                    </div>
                </div>
            )}

            {/* ── Dependencies table ── */}
            {activeTab === 'table' && dependencies.length > 0 && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-[var(--vscode-foreground)]">
                            Model + Dependencies ({dependencies.length})
                        </h2>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs text-[var(--vscode-foreground)] cursor-pointer select-none whitespace-nowrap">
                                <input
                                    type="checkbox"
                                    checked={showOnlyEnabled}
                                    onChange={e => setShowOnlyEnabled(e.target.checked)}
                                    className="accent-[var(--vscode-checkbox-background)]"
                                />
                                Show only checked
                            </label>
                            {bulkActions}
                        </div>
                    </div>

                    {/* Custom table — needs editable inputs + action buttons per row */}
                    <div className="flex gap-3 items-start">
                    <div className="flex-1 min-w-0 rounded border border-[var(--vscode-widget-border)] overflow-x-auto">
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
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[30%]">
                                        <div className="flex flex-col gap-1.5">
                                            <span>Full Table ID</span>
                                            <input
                                                type="text"
                                                value={tableIdFilter}
                                                onChange={e => setTableIdFilter(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Escape') { setTableIdFilter(''); (e.currentTarget as HTMLInputElement).blur(); } }}
                                                placeholder="Filter…"
                                                className="w-full px-2 py-1 text-xs font-normal normal-case bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] rounded outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] placeholder:text-[var(--vscode-input-placeholderForeground)]"
                                            />
                                        </div>
                                    </th>
                                    <th className="px-2 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[4%] text-center">
                                        Schema
                                    </th>
                                    <th className="px-3 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[6%] text-center">
                                        Depth
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[30%]">
                                        Filter Condition
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[24%]">
                                        Actions
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[8%]">
                                        Status
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[5%] text-center">
                                        Rows
                                    </th>
                                    <th className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] w-[6%]">
                                        Job
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--vscode-widget-border)]">
                                {visibleDependencies.length === 0 && (tableIdFilter.trim() || showOnlyEnabled) && (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-6 text-center text-xs text-[var(--vscode-descriptionForeground)]">
                                            {tableIdFilter.trim()
                                                ? `No rows match "${tableIdFilter}".`
                                                : 'No checked rows.'}
                                        </td>
                                    </tr>
                                )}
                                {visibleDependencies.map(row => {
                                    const res = results[row.id];
                                    const isLoading =
                                        res?.status === 'dry-run-loading' || res?.status === 'query-loading';
                                    return (
                                        <tr
                                            key={row.id}
                                            className={`hover:bg-[var(--vscode-list-hoverBackground)] transition-opacity ${!row.enabled ? 'opacity-65' : ''} ${row.isSelectedModel ? 'bg-[var(--vscode-textBlockQuote-background)]' : 'bg-[var(--vscode-editor-background)]'}`}
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
                                                {searchTerm ? (
                                                    <span className="font-mono text-xs break-all text-[var(--vscode-textLink-foreground)]">{hl(row.fullTableId, searchTerm)}</span>
                                                ) : (
                                                    <BigQueryTableLink
                                                        id={row.fullTableId}
                                                        className="font-mono text-xs break-all text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] hover:underline transition-colors"
                                                    />
                                                )}
                                            </td>

                                            {/* Schema */}
                                            <td className="px-2 py-2 align-middle text-center">
                                                <button
                                                    onClick={() => handleViewSchema(row.fullTableId)}
                                                    title={`View schema for ${row.fullTableId}`}
                                                    aria-label="View schema"
                                                    className={`inline-flex items-center justify-center p-1 rounded text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors ${schemaPanelOpen && schemaActiveTableId === row.fullTableId ? 'bg-[var(--vscode-toolbar-activeBackground)]' : ''}`}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                                        <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
                                                        <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" strokeWidth="1.2" />
                                                        <line x1="6" y1="6" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.2" />
                                                    </svg>
                                                </button>
                                            </td>

                                            {/* Depth */}
                                            <td className="px-3 py-2 align-middle text-center">
                                                {row.isSelectedModel ? (
                                                    <span className="px-1.5 py-0.5 text-[10px] rounded font-medium bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
                                                        model
                                                    </span>
                                                ) : (
                                                    <span className="font-mono text-xs text-[var(--vscode-descriptionForeground)]">
                                                        {row.depth}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Filter Condition */}
                                            <td className="px-4 py-2 align-middle">
                                                <AutoGrowingTextarea
                                                    value={row.filterCondition}
                                                    onChange={e => {
                                                        if (applyToAll) { return; }
                                                        updateFilterForRow(row.id, e.target.value);
                                                    }}
                                                    readOnly={applyToAll}
                                                    rows={1}
                                                    placeholder="no filter (full table scan)"
                                                    className={`w-full px-2 py-1 text-xs font-mono bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] rounded outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] placeholder:text-[var(--vscode-input-placeholderForeground)] resize-none whitespace-pre-wrap break-all overflow-hidden ${applyToAll ? 'opacity-60 cursor-not-allowed' : ''}`}
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

                                            {/* Row count */}
                                            <td className="px-4 py-2 align-middle text-center">
                                                {res?.status === 'query-success' && (
                                                    <span className={`font-mono text-xs font-semibold ${
                                                        !res.results || res.results.length === 0
                                                            ? 'text-[var(--vscode-inputValidation-warningForeground)]'
                                                            : 'text-[var(--vscode-foreground)]'
                                                    }`}>
                                                        {res.results?.length ?? 0}
                                                    </span>
                                                )}
                                            </td>

                                            {/* BQ Job link */}
                                            <td className="px-4 py-2 align-middle">
                                                {(() => {
                                                    const link = buildBqLink(res?.jobStats?.bigQueryJobId);
                                                    return link ? (
                                                        <button
                                                            onClick={() => vscode.postMessage({ command: 'openExternal', value: link })}
                                                            className="text-xs text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] hover:underline bg-transparent border-none p-0 cursor-pointer whitespace-nowrap"
                                                            title="View job in BigQuery"
                                                        >
                                                            View ↗
                                                        </button>
                                                    ) : null;
                                                })()}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {schemaAside}
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

                        const jobId: string | undefined = res.jobStats?.bigQueryJobId;
                        const bqLink = buildBqLink(jobId);

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
                                            <p className="text-xs text-[var(--vscode-descriptionForeground)]">
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
