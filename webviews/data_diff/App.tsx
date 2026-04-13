import { useState, useEffect } from "react";
import { vscode } from "./utils/vscode";
import Select, { MultiValue } from "react-select";
import * as RadixTabs from "@radix-ui/react-tabs";
import { CodeBlock } from "../components/CodeBlock";

const selectStyles = {
  control: (base: any) => ({ ...base, backgroundColor: 'var(--vscode-input-background)', borderColor: 'var(--vscode-input-border)', minHeight: '26px', fontSize: '11px', boxShadow: 'none' }),
  menu: (base: any) => ({ ...base, backgroundColor: 'var(--vscode-dropdown-background)', border: '1px solid var(--vscode-dropdown-border)', fontSize: '11px', zIndex: 9999 }),
  option: (base: any, state: any) => ({ ...base, backgroundColor: state.isFocused ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-dropdown-background)', color: state.isFocused ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-dropdown-foreground)', padding: '4px 8px', cursor: 'pointer' }),
  multiValue: (base: any) => ({ ...base, backgroundColor: 'var(--vscode-badge-background)', borderRadius: '2px' }),
  multiValueLabel: (base: any) => ({ ...base, color: 'var(--vscode-badge-foreground)', fontSize: '10px', padding: '1px 4px' }),
  multiValueRemove: (base: any) => ({ ...base, color: 'var(--vscode-badge-foreground)', '&:hover': { backgroundColor: 'transparent', color: 'var(--vscode-errorForeground)' } }),
  input: (base: any) => ({ ...base, color: 'var(--vscode-input-foreground)', margin: 0, padding: 0 }),
  placeholder: (base: any) => ({ ...base, color: 'var(--vscode-input-placeholderForeground)', fontSize: '11px' }),
  valueContainer: (base: any) => ({ ...base, padding: '0 4px' }),
  indicatorsContainer: (base: any) => ({ ...base, '& > div': { padding: '2px' } }),
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Upsert a result entry keyed by file. */
function upsertResult(prev: any[], entry: any): any[] {
  const idx = prev.findIndex(r => r.file === entry.file);
  if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
  return [...prev, entry];
}

export default function App() {
  const [mode, setMode] = useState<'branch' | 'table'>('branch');

  // Branch diff state
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [tablePrefix, setTablePrefix] = useState("");
  const [targetPrimaryKeysMap, setTargetPrimaryKeysMap] = useState<Record<string, string>>({});
  const [sourcePrimaryKeysMap, setSourcePrimaryKeysMap] = useState<Record<string, string>>({});
  const [targetFilterMap, setTargetFilterMap] = useState<Record<string, string>>({});
  const [sourceFilterMap, setSourceFilterMap] = useState<Record<string, string>>({});
  const [excludeColumnsMap, setExcludeColumnsMap] = useState<Record<string, string>>({});
  const [previewModels, setPreviewModels] = useState<any[] | null>(null);

  // Table pair diff state
  const [tableA, setTableA] = useState("");
  const [tableB, setTableB] = useState("");
  const [tablePKsA, setTablePKsA] = useState("");
  const [tablePKsB, setTablePKsB] = useState("");
  const [tableTargetFilter, setTableTargetFilter] = useState("");
  const [tableSourceFilter, setTableSourceFilter] = useState("");
  const [tableExcludeCols, setTableExcludeCols] = useState("");
  const [tableDiffing, setTableDiffing] = useState(false);
  const [tableDryRunning, setTableDryRunning] = useState(false);
  const [tableCols, setTableCols] = useState<{ target: string[], source: string[], common: string[] } | null>(null);
  const [tableColsLoading, setTableColsLoading] = useState(false);

  // Shared state
  const [isLoading, setIsLoading] = useState(true);
  const [diffResults, setDiffResults] = useState<any[]>([]);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffingFiles, setDiffingFiles] = useState<Set<string>>(new Set());
  const [dryRunningFiles, setDryRunningFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "init") {
        setSourceBranch(message.data.currentBranch);
        setAllBranches(message.data.branches);
        if (message.data.tablePrefix) { setTablePrefix(message.data.tablePrefix); }
        if (message.data.initialMode) { setMode(message.data.initialMode); }
        setIsLoading(false);
      } else if (message.command === "switchMode") {
        setMode(message.data);
      } else if (message.command === "diffComplete") {
        const newResult = message.data.results[0];
        setDiffResults(prev => upsertResult(prev, newResult));
        setDiffingFiles(prev => { const next = new Set(prev); next.delete(newResult.file); return next; });
        setTableDiffing(false);
        setDiffError(null);
      } else if (message.command === "diffError") {
        setDiffError(message.data);
        setDiffingFiles(new Set());
      } else if (message.command === "diffModelsPreview") {
        setPreviewModels(message.data);
      } else if (message.command === "dryRunResult") {
        const { file, query, bytesProcessed, cost } = message.data;
        setDiffResults(prev => upsertResult(prev, { file, dryRunOnly: true, query, bytesProcessed, cost }));
        setDryRunningFiles(prev => { const next = new Set(prev); next.delete(file); return next; });
        setTableDryRunning(false);
      } else if (message.command === "dryRunError") {
        const { file, error } = message.data;
        setDiffResults(prev => upsertResult(prev, { file, dryRunOnly: true, error }));
        setDryRunningFiles(prev => { const next = new Set(prev); next.delete(file); return next; });
        setTableDryRunning(false);
      } else if (message.command === "tablePairSchema") {
        setTableColsLoading(false);
        if (!message.data.error) {
          setTableCols({ target: message.data.targetCols, source: message.data.sourceCols, common: message.data.commonCols });
        }
      }
    };
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ command: "webviewReady" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (sourceBranch && targetBranch && tablePrefix) {
      setPreviewModels(null);
      vscode.postMessage({ command: "previewAffectedModels", data: { sourceBranch, targetBranch, tablePrefix } });
    }
  }, [sourceBranch, targetBranch, tablePrefix]);

  const isValidFullTableName = (s: string) => s.split('.').length === 3 && !s.includes(' ') && s.trim().length > 0;

  useEffect(() => {
    if (isValidFullTableName(tableA) && isValidFullTableName(tableB)) {
      setTableCols(null);
      setTableColsLoading(true);
      vscode.postMessage({ command: "fetchTablePairSchema", data: { tableA, tableB } });
    } else {
      setTableCols(null);
    }
  }, [tableA, tableB]);

  // Remove a stale dry-run-only result when the user edits params for that model.
  const clearDryRunForFile = (file: string) => {
    setDiffResults(prev => prev.filter(r => !(r.file === file && r.dryRunOnly)));
  };

  const handleDryRun = (file: string) => {
    setDryRunningFiles(prev => new Set(prev).add(file));
    // Remove any existing dry-run-only entry so the new one appears fresh
    setDiffResults(prev => prev.filter(r => !(r.file === file && r.dryRunOnly)));
    vscode.postMessage({
      command: "dryRunModelDiff",
      data: { sourceBranch, targetBranch, tablePrefix, file, targetPrimaryKeys: targetPrimaryKeysMap[file] || '', sourcePrimaryKeys: sourcePrimaryKeysMap[file] || '', targetFilter: targetFilterMap[file] || '', sourceFilter: sourceFilterMap[file] || '', excludeColumns: excludeColumnsMap[file] || '' },
    });
  };

  const handleTableDryRun = () => {
    if (!tableA || !tableB) { return; }
    setTableDryRunning(true);
    setDiffResults(prev => prev.filter(r => !(r.file === tableA && r.dryRunOnly)));
    vscode.postMessage({ command: "dryRunTablePairDiff", data: { tableA, tableB, targetPrimaryKeys: tablePKsA, sourcePrimaryKeys: tablePKsB, targetFilter: tableTargetFilter, sourceFilter: tableSourceFilter, excludeColumns: tableExcludeCols } });
  };

  const handleTableDiff = () => {
    if (!tableA || !tableB) { return; }
    setTableDiffing(true);
    setDiffError(null);
    vscode.postMessage({ command: "runTablePairDiff", data: { tableA, tableB, targetPrimaryKeys: tablePKsA, sourcePrimaryKeys: tablePKsB, targetFilter: tableTargetFilter, sourceFilter: tableSourceFilter, excludeColumns: tableExcludeCols } });
  };

  const handleRunSingleDiff = (file: string) => {
    setDiffingFiles(prev => new Set(prev).add(file));
    // Keep any existing result visible while the diff is running; diffComplete will replace it.
    setDiffError(null);
    vscode.postMessage({
      command: "runSingleModelDiff",
      data: { sourceBranch, targetBranch, tablePrefix, file, targetPrimaryKeys: targetPrimaryKeysMap[file] || '', sourcePrimaryKeys: sourcePrimaryKeysMap[file] || '', targetFilter: targetFilterMap[file] || '', sourceFilter: sourceFilterMap[file] || '', excludeColumns: excludeColumnsMap[file] || '' },
    });
  };

  const inputCls = "w-full px-1.5 py-1 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-xs rounded";

  if (isLoading) {
    return <div className="p-4 text-[var(--vscode-editor-foreground)]">Loading branch information...</div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
      {/* Header + mode tabs */}
      <div className="border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)]">
        <div className="flex items-center px-4 pt-3 pb-0 gap-6">
          {(['branch', 'table'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`pb-2 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors ${mode === m ? 'border-[var(--vscode-button-background)] text-[var(--vscode-editor-foreground)]' : 'border-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-editor-foreground)]'}`}
            >
              {m === 'branch' ? 'Branch Diff' : 'Table Diff'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Table Diff inputs */}
        {mode === 'table' && (
          <div className="mb-6">
            <div className="flex flex-wrap gap-4 mb-4">
              <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Table A — Target</span>
                <input
                  className="px-2 py-1.5 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-sm rounded"
                  type="text" value={tableA}
                  onChange={(e) => { setTableA(e.target.value); clearDryRunForFile(tableA); }}
                  placeholder="project.dataset.table"
                />
              </label>
              <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Table B — Source</span>
                <input
                  className="px-2 py-1.5 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-sm rounded"
                  type="text" value={tableB}
                  onChange={(e) => { setTableB(e.target.value); clearDryRunForFile(tableA); }}
                  placeholder="project.dataset.table"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3 mb-4">
              <label className="flex flex-col gap-1 min-w-[150px] flex-1">
                <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
                  Target PKs{tableColsLoading && <span className="ml-1 opacity-50 normal-case font-normal">loading…</span>}
                </span>
                {tableCols?.target.length ? (
                  <Select isMulti menuPortalTarget={document.body} menuPosition="fixed"
                    options={tableCols.target.map(c => ({ value: c, label: c }))}
                    value={tablePKsA.split(',').filter(Boolean).map(k => ({ value: k.trim(), label: k.trim() }))}
                    onChange={(s: MultiValue<{ value: string; label: string }>) => { setTablePKsA(s.map(x => x.value).join(',')); clearDryRunForFile(tableA); }}
                    placeholder="Select PKs…" styles={selectStyles} />
                ) : (
                  <input className={inputCls} type="text" value={tablePKsA} onChange={(e) => { setTablePKsA(e.target.value); clearDryRunForFile(tableA); }} placeholder="e.g. id,org_id" />
                )}
              </label>
              <label className="flex flex-col gap-1 min-w-[150px] flex-1">
                <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Source PKs</span>
                {tableCols?.source.length ? (
                  <Select isMulti menuPortalTarget={document.body} menuPosition="fixed"
                    options={tableCols.source.map(c => ({ value: c, label: c }))}
                    value={tablePKsB.split(',').filter(Boolean).map(k => ({ value: k.trim(), label: k.trim() }))}
                    onChange={(s: MultiValue<{ value: string; label: string }>) => { setTablePKsB(s.map(x => x.value).join(',')); clearDryRunForFile(tableA); }}
                    placeholder="Select PKs…" styles={selectStyles} />
                ) : (
                  <input className={inputCls} type="text" value={tablePKsB} onChange={(e) => { setTablePKsB(e.target.value); clearDryRunForFile(tableA); }} placeholder="e.g. id,org_id" />
                )}
              </label>
              <label className="flex flex-col gap-1 min-w-[150px] flex-1">
                <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Exclude Columns</span>
                {tableCols?.common.length ? (
                  <Select isMulti menuPortalTarget={document.body} menuPosition="fixed"
                    options={tableCols.common.map(c => ({ value: c, label: c }))}
                    value={tableExcludeCols.split(',').filter(Boolean).map(k => ({ value: k.trim(), label: k.trim() }))}
                    onChange={(s: MultiValue<{ value: string; label: string }>) => { setTableExcludeCols(s.map(x => x.value).join(',')); clearDryRunForFile(tableA); }}
                    placeholder="Exclude columns…" styles={selectStyles} />
                ) : (
                  <input className={inputCls} type="text" value={tableExcludeCols} onChange={(e) => { setTableExcludeCols(e.target.value); clearDryRunForFile(tableA); }} placeholder="e.g. updated_at" />
                )}
              </label>
              <label className="flex flex-col gap-1 min-w-[160px] flex-1">
                <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Target Filter</span>
                <input className={inputCls} type="text" value={tableTargetFilter} onChange={(e) => { setTableTargetFilter(e.target.value); clearDryRunForFile(tableA); }} placeholder="e.g. date = '2026-01-01'" />
              </label>
              <label className="flex flex-col gap-1 min-w-[160px] flex-1">
                <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Source Filter</span>
                <input className={inputCls} type="text" value={tableSourceFilter} onChange={(e) => { setTableSourceFilter(e.target.value); clearDryRunForFile(tableA); }} placeholder="e.g. date = '2026-01-01'" />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                className="px-4 py-1.5 rounded text-xs font-medium bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-40 transition-colors"
                disabled={tableDiffing || !tableA || !tableB}
                onClick={handleTableDiff}
              >
                {tableDiffing ? "Running…" : "Diff"}
              </button>
              <button
                className="px-4 py-1.5 rounded text-xs font-medium border border-[var(--vscode-button-background)] text-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-background)]/10 disabled:opacity-40 transition-colors"
                disabled={tableDryRunning || !tableA || !tableB}
                onClick={handleTableDryRun}
              >
                {tableDryRunning ? "Estimating…" : "Dry Run"}
              </button>
            </div>
          </div>
        )}

        {/* Branch Diff config inputs + models preview */}
        {mode === 'branch' && <><div className="flex flex-wrap gap-4 mb-6">
          <label className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Source Branch</span>
            <input
              className="px-2 py-1.5 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-sm opacity-60 rounded"
              type="text" value={sourceBranch} disabled
            />
          </label>

          <label className="flex flex-col gap-1 min-w-[200px]">
            <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Target Branch</span>
            <Select
              options={allBranches.map(b => ({ value: b, label: b }))}
              value={targetBranch ? { value: targetBranch, label: targetBranch } : null}
              onChange={(opt) => setTargetBranch(opt?.value ?? '')}
              placeholder="Select target branch…"
              styles={{
                control: (base) => ({ ...base, backgroundColor: 'var(--vscode-input-background)', borderColor: 'var(--vscode-input-border)', fontSize: '13px', minHeight: '32px', boxShadow: 'none' }),
                menu: (base) => ({ ...base, backgroundColor: 'var(--vscode-dropdown-background)', border: '1px solid var(--vscode-dropdown-border)', zIndex: 9999 }),
                option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-dropdown-background)', color: state.isFocused ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-dropdown-foreground)', padding: '6px 10px', cursor: 'pointer' }),
                singleValue: (base) => ({ ...base, color: 'var(--vscode-input-foreground)' }),
                input: (base) => ({ ...base, color: 'var(--vscode-input-foreground)' }),
                placeholder: (base) => ({ ...base, color: 'var(--vscode-input-placeholderForeground)' }),
              }}
            />
          </label>

          <label className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
              Table Prefix <span className="font-mono normal-case opacity-70 text-[10px]">--table-prefix</span>
            </span>
            <input
              className="px-2 py-1.5 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] text-sm rounded"
              type="text" value={tablePrefix} onChange={(e) => setTablePrefix(e.target.value)} placeholder="e.g. feat_123"
            />
          </label>
        </div>

        {/* Models preview */}
        {previewModels === null && targetBranch && tablePrefix && (
          <div className="text-xs text-[var(--vscode-descriptionForeground)] mb-4">Loading models…</div>
        )}

        {previewModels && previewModels.length === 0 && (
          <div className="mb-4 px-3 py-2 border border-[var(--vscode-inputValidation-warningBorder)] bg-[var(--vscode-inputValidation-warningBackground)] text-[var(--vscode-inputValidation-warningForeground)] rounded text-sm">
            No modified models found between the selected branches.
          </div>
        )}

        {previewModels && previewModels.length > 0 && (
          <div className="mb-6 border border-[var(--vscode-widget-border)] rounded overflow-hidden">
            <div className="px-4 py-2 bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)]">
              <span className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
                Models to Compare ({previewModels.length})
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)]">
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">File</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Target (A)</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Source (B)</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Target PKs</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Source PKs</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Exclude Columns</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Target Filter</th>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--vscode-descriptionForeground)]">Source Filter</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {previewModels.map((model) => {
                    const isFileDiffing = diffingFiles.has(model.file);
                    const isDryRunning = dryRunningFiles.has(model.file);
                    const bothMissing = !model.baseExists && !model.featExists;
                    return (
                      <tr key={model.file} className="border-b border-[var(--vscode-widget-border)]/40 last:border-0 hover:bg-[var(--vscode-list-hoverBackground)]">
                        <td className="px-3 py-2 font-mono break-all max-w-[120px]" title={model.file}>{model.file.split('/').pop()}</td>
                        <td className="px-3 py-2 font-mono text-[var(--vscode-descriptionForeground)] break-all max-w-[160px]">{model.baseTableName.split('.').pop()}</td>
                        <td className="px-3 py-2 font-mono text-[var(--vscode-descriptionForeground)] break-all max-w-[160px]">{model.featTableName.split('.').pop()}</td>
                        <td className="px-3 py-2 min-w-[160px]">
                          {model.targetColumns?.length > 0 ? (
                            <Select isMulti menuPortalTarget={document.body} menuPosition="fixed"
                              options={model.targetColumns.map((c: string) => ({ value: c, label: c }))}
                              value={(targetPrimaryKeysMap[model.file] || '').split(',').filter(Boolean).map((k: string) => ({ value: k.trim(), label: k.trim() }))}
                              onChange={(s: MultiValue<{ value: string; label: string }>) => { setTargetPrimaryKeysMap(prev => ({ ...prev, [model.file]: s.map(x => x.value).join(',') })); clearDryRunForFile(model.file); }}
                              placeholder="Select PKs…" styles={selectStyles} />
                          ) : (
                            <input className={inputCls} type="text" value={targetPrimaryKeysMap[model.file] || ''} onChange={(e) => { setTargetPrimaryKeysMap(prev => ({ ...prev, [model.file]: e.target.value })); clearDryRunForFile(model.file); }} placeholder="e.g. ORG_ID" />
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[160px]">
                          {model.sourceColumns?.length > 0 ? (
                            <Select isMulti menuPortalTarget={document.body} menuPosition="fixed"
                              options={model.sourceColumns.map((c: string) => ({ value: c, label: c }))}
                              value={(sourcePrimaryKeysMap[model.file] || '').split(',').filter(Boolean).map((k: string) => ({ value: k.trim(), label: k.trim() }))}
                              onChange={(s: MultiValue<{ value: string; label: string }>) => { setSourcePrimaryKeysMap(prev => ({ ...prev, [model.file]: s.map(x => x.value).join(',') })); clearDryRunForFile(model.file); }}
                              placeholder="Select PKs…" styles={selectStyles} />
                          ) : (
                            <input className={inputCls} type="text" value={sourcePrimaryKeysMap[model.file] || ''} onChange={(e) => { setSourcePrimaryKeysMap(prev => ({ ...prev, [model.file]: e.target.value })); clearDryRunForFile(model.file); }} placeholder="e.g. ORG_ID" />
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[160px]">
                          {model.columns?.length > 0 ? (
                            <Select isMulti menuPortalTarget={document.body} menuPosition="fixed"
                              options={model.columns.map((c: string) => ({ value: c, label: c }))}
                              value={(excludeColumnsMap[model.file] || '').split(',').filter(Boolean).map(k => ({ value: k.trim(), label: k.trim() }))}
                              onChange={(s: MultiValue<{ value: string; label: string }>) => { setExcludeColumnsMap(prev => ({ ...prev, [model.file]: s.map(x => x.value).join(',') })); clearDryRunForFile(model.file); }}
                              placeholder="Exclude columns…" styles={selectStyles} />
                          ) : (
                            <input className={inputCls} type="text" value={excludeColumnsMap[model.file] || ''} onChange={(e) => { setExcludeColumnsMap(prev => ({ ...prev, [model.file]: e.target.value })); clearDryRunForFile(model.file); }} placeholder="e.g. UPDATED_AT" />
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[180px]">
                          <input className={inputCls} type="text" value={targetFilterMap[model.file] || ''} onChange={(e) => { setTargetFilterMap(prev => ({ ...prev, [model.file]: e.target.value })); clearDryRunForFile(model.file); }} placeholder="e.g. date = '2026-01-01'" />
                        </td>
                        <td className="px-3 py-2 min-w-[180px]">
                          <input className={inputCls} type="text" value={sourceFilterMap[model.file] || ''} onChange={(e) => { setSourceFilterMap(prev => ({ ...prev, [model.file]: e.target.value })); clearDryRunForFile(model.file); }} placeholder="e.g. date = '2026-01-01'" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <button
                              className="px-3 py-1 rounded text-xs font-medium bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-40 whitespace-nowrap transition-colors"
                              disabled={isFileDiffing || bothMissing}
                              title={bothMissing ? 'Neither table is materialized' : undefined}
                              onClick={() => handleRunSingleDiff(model.file)}
                            >
                              {isFileDiffing ? "Running…" : "Diff"}
                            </button>
                            <button
                              className="px-3 py-1 rounded text-xs font-medium border border-[var(--vscode-button-background)] text-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-background)]/10 disabled:opacity-40 whitespace-nowrap transition-colors"
                              disabled={isDryRunning || bothMissing}
                              title={bothMissing ? 'Neither table is materialized' : 'Estimate query cost without running'}
                              onClick={() => handleDryRun(model.file)}
                            >
                              {isDryRunning ? "Estimating…" : "Dry Run"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        </>}

        {/* Diff Results */}
        <div className="border-t border-[var(--vscode-widget-border)] pt-4">
          <h2 className="text-sm font-semibold text-[var(--vscode-descriptionForeground)] uppercase tracking-wide mb-4">Diff Results</h2>
          {diffError && (
            <div className="mb-4 px-3 py-2 border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] rounded text-sm">
              {diffError}
            </div>
          )}

          {diffResults.length > 0 ? (
            <div className="flex flex-col gap-4">
              {diffResults.map((result) => (
                <div key={result.file + (result.dryRunOnly ? '-dry' : '-full')} className="border border-[var(--vscode-widget-border)] rounded overflow-hidden">
                  <div className="px-4 py-2 bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)] flex items-center gap-2">
                    <span className="text-xs font-mono break-all text-[var(--vscode-editor-foreground)]">{result.file}</span>
                    {result.dryRunOnly && (
                      <span className="ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
                        Dry Run
                      </span>
                    )}
                    {diffingFiles.has(result.file) && (
                      <span className="ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">
                        Running…
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    {result.dryRunOnly ? (
                      /* ── Dry-run-only card ── */
                      result.error ? (
                        <div className="px-3 py-2 border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] rounded text-xs font-mono">
                          {result.error}
                        </div>
                      ) : (
                        <RadixTabs.Root defaultValue="estimate" className="w-full">
                          <RadixTabs.List className="flex border-b border-[var(--vscode-widget-border)] mb-4">
                            <RadixTabs.Trigger value="estimate" className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px">
                              Estimate
                            </RadixTabs.Trigger>
                            <RadixTabs.Trigger value="query" className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px">
                              Comparison Query
                            </RadixTabs.Trigger>
                          </RadixTabs.List>
                          <RadixTabs.Content value="estimate">
                            <div className="flex items-center gap-3 flex-wrap mb-3">
                              <span className="bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] px-2 py-0.5 rounded text-xs font-mono">
                                {formatBytes(result.bytesProcessed)} processed
                              </span>
                              {result.cost && (
                                <span className="bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] px-2 py-0.5 rounded text-xs font-mono">
                                  ~{result.cost.currency} {result.cost.value.toFixed(4)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[var(--vscode-descriptionForeground)] italic">Run Diff to see row-level results.</p>
                          </RadixTabs.Content>
                          <RadixTabs.Content value="query">
                            <div className="mt-2 w-full overflow-hidden">
                              <CodeBlock code={result.query || 'No query generated.'} language="sql" showLineNumbers />
                            </div>
                          </RadixTabs.Content>
                        </RadixTabs.Root>
                      )
                    ) : result.error ? (
                      /* ── Full diff error card ── */
                      <div className="flex flex-col gap-3">
                        <div className="px-3 py-2 border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] text-[var(--vscode-inputValidation-errorForeground)] rounded text-xs font-mono">
                          {result.error}
                        </div>
                        {result.comparisonQuery && (
                          <div>
                            <p className="text-xs text-[var(--vscode-descriptionForeground)] mb-1">Query used:</p>
                            <div className="w-full overflow-hidden">
                              <CodeBlock code={result.comparisonQuery} language="sql" showLineNumbers />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* ── Full diff result card ── */
                      <RadixTabs.Root defaultValue="summary" className="w-full">
                        <RadixTabs.List className="flex border-b border-[var(--vscode-widget-border)] mb-4">
                          <RadixTabs.Trigger value="summary" className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px">
                            Summary
                          </RadixTabs.Trigger>
                          <RadixTabs.Trigger value="query" className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px">
                            Comparison Query
                          </RadixTabs.Trigger>
                        </RadixTabs.List>

                        <RadixTabs.Content value="summary">
                          {(() => {
                            const baseDay = result.baseLastModified ? new Date(result.baseLastModified).toDateString() : null;
                            const featDay = result.featLastModified ? new Date(result.featLastModified).toDateString() : null;
                            return baseDay && featDay && baseDay !== featDay ? (
                              <div className="mb-3 flex items-center gap-2 text-xs px-3 py-2 rounded border border-[var(--vscode-inputValidation-warningBorder)] bg-[var(--vscode-inputValidation-warningBackground)] text-[var(--vscode-inputValidation-warningForeground)]">
                                <span className="text-sm">⚠</span>
                                <span>Target and source were last updated on different days.</span>
                              </div>
                            ) : null;
                          })()}
                          <table className="mb-3 text-xs border-collapse w-full">
                            <thead>
                              <tr className="border-b border-[var(--vscode-widget-border)]">
                                <th className="text-left py-1 pr-4 font-semibold text-[var(--vscode-descriptionForeground)] w-14"></th>
                                <th className="text-left py-1 pr-4 font-semibold text-[var(--vscode-descriptionForeground)]">Table</th>
                                <th className="text-left py-1 font-semibold text-[var(--vscode-descriptionForeground)] whitespace-nowrap">Last Updated</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-b border-[var(--vscode-widget-border)]/40">
                                <td className="py-1.5 pr-4 text-[var(--vscode-descriptionForeground)] font-medium">Target</td>
                                <td className="py-1.5 pr-4"><code className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-1.5 py-0.5 rounded break-all">{result.baseTableFullName || result.baseTableName}</code></td>
                                <td className="py-1.5 text-[var(--vscode-descriptionForeground)] whitespace-nowrap">{result.baseLastModified ? new Date(result.baseLastModified).toLocaleString() : '—'}</td>
                              </tr>
                              <tr>
                                <td className="py-1.5 pr-4 text-[var(--vscode-descriptionForeground)] font-medium">Source</td>
                                <td className="py-1.5 pr-4"><code className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-1.5 py-0.5 rounded break-all">{result.featTableFullName || result.featTableName}</code></td>
                                <td className="py-1.5 text-[var(--vscode-descriptionForeground)] whitespace-nowrap">{result.featLastModified ? new Date(result.featLastModified).toLocaleString() : '—'}</td>
                              </tr>
                            </tbody>
                          </table>

                          {(result.targetFilter || result.sourceFilter) && (
                            <div className="mb-3 flex flex-col gap-1 text-xs text-[var(--vscode-descriptionForeground)]">
                              {result.targetFilter && (
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 w-20">Target filter:</span>
                                  <code className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-1.5 py-0.5 rounded">{result.targetFilter}</code>
                                </div>
                              )}
                              {result.sourceFilter && (
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 w-20">Source filter:</span>
                                  <code className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-1.5 py-0.5 rounded">{result.sourceFilter}</code>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex gap-3 mb-4 flex-wrap">
                            <span className="bg-green-900/30 text-green-400 border border-green-900/50 px-3 py-1 rounded text-xs">Added: {result.addedCount}</span>
                            <span className="bg-red-900/30 text-red-400 border border-red-900/50 px-3 py-1 rounded text-xs">Removed: {result.removedCount}</span>
                            {result.modifiedCount !== undefined && (
                              <span className="bg-blue-900/30 text-blue-400 border border-blue-900/50 px-3 py-1 rounded text-xs">Modified: {result.modifiedCount}</span>
                            )}
                          </div>

                          {result.schemaAddedCols?.length > 0 && (
                            <p className="text-xs mt-2 text-green-400">Schema Added: {result.schemaAddedCols.join(', ')}</p>
                          )}
                          {result.schemaRemovedCols?.length > 0 && (
                            <p className="text-xs mt-1 text-red-400">Schema Removed: {result.schemaRemovedCols.join(', ')}</p>
                          )}

                          {result.isPairedDiff ? (
                            Object.keys(result.changedColumns || {}).length > 0 && (
                              <div className="mt-4">
                                <h4 className="text-xs font-semibold mb-2 text-[var(--vscode-descriptionForeground)]">Modified Columns (Rows Changed)</h4>
                                <div className="flex flex-wrap gap-2">
                                  {Object.entries(result.changedColumns).sort((a: any, b: any) => b[1] - a[1]).map(([col, count]: [string, any]) => (
                                    <div key={col} className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-2 py-1 rounded text-xs">
                                      {col} <span className="text-[var(--vscode-descriptionForeground)] ml-1 opacity-70">({count})</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          ) : (
                            (result.modifiedCount ?? 0) > 0 && (
                              <div className="mt-4 p-3 bg-[var(--vscode-inputValidation-warningBackground)] border border-[var(--vscode-inputValidation-warningBorder)] rounded flex gap-2">
                                <span className="text-yellow-500 shrink-0">⚠</span>
                                <span className="text-xs text-[var(--vscode-inputValidation-warningForeground)]">
                                  Column-level diff unavailable — this model has no <code className="bg-[var(--vscode-editor-background)] px-1 rounded font-mono">uniqueKey</code>. Add one in your SQLX config to unlock column diffs.
                                </span>
                              </div>
                            )
                          )}
                        </RadixTabs.Content>

                        <RadixTabs.Content value="query">
                          <div className="mt-2 w-full overflow-hidden">
                            <CodeBlock code={result.comparisonQuery || 'No query generated.'} language="sql" showLineNumbers />
                          </div>
                        </RadixTabs.Content>
                      </RadixTabs.Root>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[var(--vscode-descriptionForeground)] text-sm italic">Run a diff to see results here.</p>
          )}
        </div>
      </div>
    </div>
  );
}
