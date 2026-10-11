import React, { useEffect, useMemo, useState } from 'react';
import { panelProblem } from "../utils/panelProblem";
import { PanelState } from '../types';
import { vscode } from '../utils/vscode';
import clsx from 'clsx';
import { Loader2, AlertCircle, Calculator, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { ModifierSwitch } from './ModifierSwitch';
import { ROW_BUTTON, ROW_LABEL, ROW_PRIMARY_BUTTON, RowChip, SummaryRow } from './SummaryRow';
import { UNKNOWN_ACCURACY_TOOLTIP } from '../../utils/dryRunAccuracy';
import { parseBigQueryTableId } from '../../utils/bigquery';
import { ACTION_TYPE_BADGE_STYLES, DEFAULT_BADGE_STYLE } from '../utils/constants';

interface CostEstimatorTabProps {
  state: PanelState;
}

type CostEstimateRow = {
    targetName: string;
    schema: string;
    type: string;
    statementType: string;
    totalBytesProcessedAccuracy: string;
    // undefined when BigQuery could not estimate the bytes (accuracy UNKNOWN)
    totalGBProcessed?: string; // or number? <b>parseFloat</b> was used in previous implementation
    costOfRunningModel?: string;
    bytesEstimateUnknown?: boolean;
    error?: string;
};

/** A row of the estimate as the list shows it: where it is, how its dry run ended and what it came to */
interface CostAction {
    id: string;
    /** `project.dataset`, which the actions are grouped under */
    dataset: string;
    name: string;
    type: string;
    statementType: string;
    status: "failed" | "estimated" | "unknown";
    /** How sure BigQuery is of the bytes, in its own word */
    accuracy: string;
    gib: number;
    cost: number;
    error: string;
}

/** The actions of a dataset, with what they come to */
interface CostGroup {
    dataset: string;
    actions: CostAction[];
    failed: number;
    unknown: number;
    gib: number;
    cost: number;
}

const numberOf = (value: unknown): number => {
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? 0 : parsed;
};

function costActionOf(row: CostEstimateRow): CostAction {
    const target = parseBigQueryTableId(row.targetName);
    const status = row.error ? "failed" : row.bytesEstimateUnknown ? "unknown" : "estimated";
    return {
        id: row.targetName,
        dataset: target ? `${target.database}.${target.schema}` : row.schema || "",
        name: target ? target.name : row.targetName,
        type: row.type,
        statementType: row.statementType || "",
        status,
        accuracy: status === "unknown" ? "unknown" : (row.totalBytesProcessedAccuracy || "").toLowerCase().replace(/_/g, " "),
        gib: status === "estimated" ? numberOf(row.totalGBProcessed) : 0,
        cost: status === "estimated" ? numberOf(row.costOfRunningModel) : 0,
        error: row.error || "",
    };
}

// What needs a look is first, then what costs the most. What has no estimate has nothing to be ranked by
const STATUS_RANK: Record<CostAction["status"], number> = { failed: 0, estimated: 1, unknown: 2 };
const byRankThenCost = (a: CostAction, b: CostAction) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.cost - a.cost;
const sumOf = (actions: CostAction[], key: "gib" | "cost") => actions.reduce((sum, action) => sum + action[key], 0);

/** The actions under their datasets: a dataset with a failure first, then the one that costs the most */
export function groupCostActions(actions: CostAction[]): CostGroup[] {
    const groups = new Map<string, CostAction[]>();
    for (const action of actions) {
        groups.set(action.dataset, [...(groups.get(action.dataset) ?? []), action]);
    }
    return [...groups.entries()]
        .map(([dataset, of]) => ({
            dataset,
            actions: [...of].sort(byRankThenCost),
            failed: of.filter((action) => action.status === "failed").length,
            unknown: of.filter((action) => action.status === "unknown").length,
            gib: sumOf(of, "gib"),
            cost: sumOf(of, "cost"),
        }))
        .sort((a, b) => Number(b.failed > 0) - Number(a.failed > 0) || b.cost - a.cost);
}

const KIND_LABEL: Record<string, string> = { incremental: "incr", operations: "ops", assertion: "assert" };
/** The kind of an action, as wide for every kind: the names beside them start in one line */
const Kind: React.FC<{ type: string }> = ({ type }) => {
    const style = ACTION_TYPE_BADGE_STYLES[type] || DEFAULT_BADGE_STYLE;
    return <span title={type} className={`flex-shrink-0 w-[46px] text-center text-[9.5px] uppercase font-bold tracking-wider py-px rounded border ${style.bg} ${style.text} ${style.border}`}>{KIND_LABEL[type] ?? type}</span>;
};

const WARNING = "var(--vscode-editorWarning-foreground, #cca700)";
const ERROR = "var(--vscode-errorForeground, #f14c4c)";
const STATUS_COLOR: Record<CostAction["status"], string | undefined> = { failed: ERROR, unknown: WARNING, estimated: undefined };
// The columns at the end of each line of the list, and of the line that names them. In a panel too narrow for all of
// them the GiB go, which the cost follows from: the name of the action needs the room more
const ACCURACY_COLUMN = "w-[68px] flex-shrink-0 text-[11px] whitespace-nowrap";
const GIB_COLUMN = "hidden min-[420px]:block w-[48px] flex-shrink-0 text-right font-mono text-xs tabular-nums whitespace-nowrap";
const COST_COLUMN = "w-[52px] flex-shrink-0 text-right font-mono text-xs tabular-nums whitespace-nowrap";
const HEADING = "font-mono text-[10px] uppercase tracking-wider text-[var(--vscode-descriptionForeground)]";

/** A count of the Result row that narrows the list to what it counts */
const FilterChip: React.FC<{ color: string; on: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ color, on, onClick, title, children }) => (
    <button
        type="button"
        aria-pressed={on}
        onClick={onClick}
        title={title}
        className="inline-flex items-center flex-shrink-0 px-1.5 h-[18px] rounded border font-mono text-[10.5px] whitespace-nowrap focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
        style={{ color, borderColor: `color-mix(in srgb, ${color} ${on ? 100 : 50}%, transparent)`, background: `color-mix(in srgb, ${color} ${on ? 28 : 10}%, transparent)` }}
    >
        {children}
    </button>
);

export const CostEstimatorTab: React.FC<CostEstimatorTabProps> = ({ state }) => {
  const [selectedTags, setSelectedTags] = useState<string[]>(state.dataform.tagCostEstimate?.tags || []);
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [includeDependents, setIncludeDependents] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  /** The Result row's count the list is narrowed to */
  const [only, setOnly] = useState<"failed" | "unknown" | null>(null);
  /** The datasets whose actions are folded away */
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => {
     if (state.dataform.tagCostEstimate?.tags) {
         setSelectedTags(state.dataform.tagCostEstimate?.tags);
     }
  }, [state.dataform.tagCostEstimate?.tags]);

  const handleEstimate = () => {
    if (selectedTags.length === 0) {
        return;
    }
    setLoading(true);
    vscode.postMessage({
        command: 'dataform.estimateTagCost',
        tags: selectedTags,
        includeDependencies,
        includeDependents,
    });
  };

  const handleExportCsv = () => {
      if (!data || data.length === 0) {
          return;
      }
      
      const headers = ["Target", "Schema", "Type", "Statement type", "Accuracy", "GiB proc.", "Cost", "Error"];
      
      const csvRows = [headers.join(',')];
      
      for (const row of data) {
          const values = [
              `"${row.targetName || ''}"`,
              `"${row.schema || ''}"`,
              `"${row.type || ''}"`,
              `"${row.statementType || ''}"`,
              `"${row.totalBytesProcessedAccuracy || ''}"`,
              row.bytesEstimateUnknown ? 'unknown' : (row.totalGBProcessed !== undefined && !isNaN(Number(row.totalGBProcessed)) ? Number(row.totalGBProcessed).toFixed(2) : ''),
              row.bytesEstimateUnknown ? 'unknown' : (row.costOfRunningModel !== undefined && !isNaN(Number(row.costOfRunningModel)) ? Number(row.costOfRunningModel).toFixed(2) : ''),
              `"${(row.error || '').replace(/"/g, '""')}"`
          ];
          csvRows.push(values.join(','));
      }
      
      const csvString = csvRows.join('\n');
      
      vscode.postMessage({
          command: 'dataform.exportTagCostCsv',
          content: csvString,
          fileName: `cost_estimate_${selectedTags.join('_')}.csv`
      });
  };

  // What is wrong with the file or its compile is shown here too, ahead of the estimate's own error
  const panelMessage = panelProblem(state).message;

  useEffect(() => {
      // Clear loading if we get a result or error
       if (state.dataform.tagCostEstimate || panelMessage) {
           setLoading(false);
       }
  }, [state.dataform.tagCostEstimate, panelMessage]);

  const data = useMemo(() => {
      // The contract leaves a row's shape to the host
      const list = (state.dataform.tagCostEstimate?.rows ?? []) as CostEstimateRow[];
      return [...list].sort((a, b) => {
          // Sort errors to the top
          const aHasError = !!a.error;
          const bHasError = !!b.error;
          if (aHasError && !bHasError) {
              return -1;
          }
          if (!aHasError && bHasError) {
              return 1;
          }
          return 0;
      });
  }, [state.dataform.tagCostEstimate]);
  const currencySymbol = state.bigquery?.currencySymbol || "$";

  const tags = state.project?.tags ?? [];
  const shownTags = tags.filter((tag) => tag.toLowerCase().includes(tagFilter.trim().toLowerCase()));
  const estimateError = panelMessage || state.dataform.tagCostEstimate?.error;

  // The estimate as the list shows it: under its datasets, narrowed by the filter and by the count that was clicked
  const actions = useMemo(() => data.map(costActionOf), [data]);
  const failedCount = actions.filter((action) => action.status === "failed").length;
  const unknownCount = actions.filter((action) => action.status === "unknown").length;
  const narrowedTo = only === "failed" && failedCount === 0 ? null : only === "unknown" && unknownCount === 0 ? null : only;
  const shown = useMemo(() => {
      const wanted = actionFilter.trim().toLowerCase();
      return actions.filter((action) => (!wanted || action.id.toLowerCase().includes(wanted)) && (!narrowedTo || action.status === narrowedTo));
  }, [actions, actionFilter, narrowedTo]);
  const groups = useMemo(() => groupCostActions(shown), [shown]);
  const formatCost = (cost: number) => cost > 0 && cost < 0.005 ? `<${currencySymbol}0.01` : `${currencySymbol}${cost.toFixed(2)}`;
  const toggleGroup = (dataset: string) => setClosed((was) => {
      const next = new Set(was);
      if (!next.delete(dataset)) { next.add(dataset); }
      return next;
  });
  const openAction = (action: CostAction) => {
      const target = parseBigQueryTableId(action.id);
      if (target) {
          vscode.postMessage({ command: "openAction", action: target });
      }
  };

  return (
    <div className="pb-10">
        {/* The panel's padding is taken back: the rows run from edge to edge, as those of the compiled query do */}
        <div className="-mx-4 -mt-4">
            <div className={clsx("flex gap-2 px-3 py-[3px] border-b border-[var(--vscode-widget-border)] text-[12.5px]", tags.length === 0 && "opacity-50")}>
                <span className={clsx(ROW_LABEL, "leading-6")}>Tags</span>
                {tags.length === 0 ? <span className="leading-6">no tags in this project</span> : (
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
                        {/* A filter is worth its room only where the tags are many */}
                        {tags.length > 12 && (
                            <input
                                type="text"
                                value={tagFilter}
                                onChange={(e) => setTagFilter(e.target.value)}
                                placeholder="Filter…"
                                aria-label="Filter the tags"
                                className="w-[112px] h-6 px-2 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border,var(--vscode-widget-border))] text-xs text-[var(--vscode-input-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)] focus:outline-none focus:border-[var(--vscode-focusBorder)]"
                            />
                        )}
                        {shownTags.map((tag) => (
                            <ModifierSwitch
                                key={tag}
                                chip
                                label={tag}
                                checked={selectedTags.includes(tag)}
                                onChange={(checked) => setSelectedTags((chosen) => checked ? [...chosen, tag] : chosen.filter((other) => other !== tag))}
                                title={selectedTags.includes(tag) ? `Leave the tag ${tag} out of the estimate` : `Estimate the tag ${tag}`}
                            />
                        ))}
                        {shownTags.length === 0 && <span className="italic text-[var(--vscode-descriptionForeground)]">No tag has "{tagFilter}" in its name</span>}
                        {selectedTags.length > 0 && (
                            <button onClick={() => setSelectedTags([])} className="ml-1 bg-transparent border-0 p-0 text-xs text-[var(--vscode-textLink-foreground)] hover:underline">Clear</button>
                        )}
                    </div>
                )}
            </div>

            <div className="border-b border-[var(--vscode-widget-border)] text-[12.5px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[30px] px-3 py-[3px]">
                    <span className={ROW_LABEL}>Estimate</span>
                    <div role="group" aria-label="Estimate modifiers" className="flex items-center gap-1 flex-shrink-0">
                        <ModifierSwitch chip label="+Deps" checked={includeDependencies} onChange={setIncludeDependencies} title="Include the dependencies of the tags' actions" />
                        <ModifierSwitch chip label="+Dependents" checked={includeDependents} onChange={setIncludeDependents} title="Include the dependents of the tags' actions" />
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                        <button onClick={handleExportCsv} disabled={data.length === 0 || loading} className={ROW_BUTTON} title="Save the estimate as a CSV file">
                            <Download className="w-3 h-3" /> Export CSV
                        </button>
                        <button
                            onClick={handleEstimate}
                            disabled={selectedTags.length === 0 || loading}
                            className={ROW_PRIMARY_BUTTON}
                            title={selectedTags.length === 0 ? "Choose a tag to estimate" : `Estimate what a run of ${selectedTags.join(", ")} would cost`}
                        >
                            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />} Estimate Cost
                        </button>
                    </div>
                </div>
            </div>

            <SummaryRow label="Method" summary="A dry run of the full query each action of the tags would run">
                <ul className="m-0 p-0 list-none space-y-1 text-xs text-[var(--vscode-descriptionForeground)]">
                    <li><span className="text-[var(--vscode-foreground)]">Table / View:</span> Pre-operation + Create or replace statement + Main query</li>
                    <li><span className="text-[var(--vscode-foreground)]">Partitioned / Clustered Tables:</span> Pre-operations + Main query</li>
                    <li><span className="text-[var(--vscode-foreground)]">Incremental:</span> Incremental pre-operation query + Create or replace statement + Main query</li>
                    <li><span className="text-[var(--vscode-foreground)]">Partitioned / Clustered Incremental:</span> Incremental pre-operation query + Main query</li>
                    <li><span className="text-[var(--vscode-foreground)]">Assertion & Operation:</span> Main query</li>
                </ul>
            </SummaryRow>

            {(loading || estimateError) ? (
                <SummaryRow
                    label="Result"
                    tone={loading ? "busy" : "error"}
                    summary={loading ? (
                        <><Loader2 className="inline w-3.5 h-3.5 mr-1.5 align-middle animate-spin text-[var(--vscode-textLink-foreground)]" /><span className="align-middle">Estimating, with a dry run of each action…</span></>
                    ) : "Estimation Failed"}
                >
                    {estimateError && !loading ? (
                        <div className="bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)] px-3 py-2 rounded text-xs text-[var(--vscode-inputValidation-errorForeground)] flex items-start gap-2">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <div className="overflow-auto whitespace-pre-wrap">{estimateError}</div>
                        </div>
                    ) : null}
                </SummaryRow>
            ) : actions.length > 0 && (
                // Its counts are buttons, so it is no row that opens: a button cannot hold another
                <div className="relative flex items-center gap-1.5 min-h-[30px] px-3 border-b border-[var(--vscode-widget-border)] text-[12.5px]">
                    <span className={clsx(ROW_LABEL, "mr-0.5")}>Result</span>
                    {failedCount > 0 && (
                        <FilterChip color={ERROR} on={narrowedTo === "failed"} onClick={() => setOnly(narrowedTo === "failed" ? null : "failed")} title={narrowedTo === "failed" ? "Show every action" : "Show only the actions whose dry run failed"}>
                            {failedCount} failed
                        </FilterChip>
                    )}
                    {unknownCount > 0 && (
                        <FilterChip color={WARNING} on={narrowedTo === "unknown"} onClick={() => setOnly(narrowedTo === "unknown" ? null : "unknown")} title={narrowedTo === "unknown" ? "Show every action" : `Show only the actions with no estimate. ${UNKNOWN_ACCURACY_TOOLTIP}`}>
                            {unknownCount} unknown
                        </FilterChip>
                    )}
                    <span className="min-w-0 truncate text-[var(--vscode-foreground)]">
                        {shown.length === actions.length ? actions.length : `${shown.length} of ${actions.length}`} action{actions.length === 1 ? "" : "s"} · {sumOf(shown, "gib").toFixed(2)} GiB · {formatCost(sumOf(shown, "cost"))}
                    </span>
                </div>
            )}

            {actions.length > 0 && !loading && !estimateError && (
                <div data-cost="actions">
                    <div className="sticky -top-4 z-[2] flex items-center gap-2 h-[30px] px-3 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)]">
                        <input
                            type="text"
                            value={actionFilter}
                            onChange={(e) => setActionFilter(e.target.value)}
                            placeholder="Filter actions…"
                            aria-label="Filter the actions"
                            className="flex-1 min-w-[60px] max-w-[220px] h-[22px] px-2 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border,var(--vscode-widget-border))] text-xs text-[var(--vscode-input-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)] focus:outline-none focus:border-[var(--vscode-focusBorder)]"
                        />
                        <span className="flex-1" />
                        <span className={clsx(HEADING, ACCURACY_COLUMN, "!text-[10px]")}>Accuracy</span>
                        <span className={clsx(HEADING, GIB_COLUMN, "!text-[10px]")}>GiB</span>
                        <span className={clsx(HEADING, COST_COLUMN, "!text-[10px]")}>Cost</span>
                    </div>
                    {groups.map((group) => {
                        const open = !closed.has(group.dataset);
                        const [project, ...rest] = group.dataset.split(".");
                        return (
                            <section key={group.dataset} aria-label={group.dataset || "No dataset"}>
                                <button
                                    type="button"
                                    onClick={() => toggleGroup(group.dataset)}
                                    aria-expanded={open}
                                    title={group.dataset}
                                    className="sticky top-[14px] z-[1] flex items-center gap-2 w-full h-7 px-3 text-left text-[12.5px] border-0 border-b border-solid border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] text-[var(--vscode-foreground)] cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
                                >
                                    {open ? <ChevronDown className="w-3 h-3 flex-shrink-0 text-[var(--vscode-descriptionForeground)]" /> : <ChevronRight className="w-3 h-3 flex-shrink-0 text-[var(--vscode-descriptionForeground)]" />}
                                    <span className="min-w-0 truncate font-mono">
                                        {rest.length > 0
                                            ? <><span className="hidden min-[560px]:inline text-[var(--vscode-descriptionForeground)]">{project}.</span><span className="font-semibold">{rest.join(".")}</span></>
                                            : <span className="font-semibold">{group.dataset || "no dataset"}</span>}
                                    </span>
                                    <span className="flex-shrink-0 text-[11px] text-[var(--vscode-descriptionForeground)]">{group.actions.length}</span>
                                    <span className="flex-1" />
                                    {group.failed > 0 && <RowChip tone="error">{group.failed} failed</RowChip>}
                                    {group.unknown > 0 && <RowChip tone="warning" title={UNKNOWN_ACCURACY_TOOLTIP}>{group.unknown} unknown</RowChip>}
                                    <span className={clsx(GIB_COLUMN, "text-[var(--vscode-descriptionForeground)]")}>{group.gib.toFixed(2)}</span>
                                    <span className={clsx(COST_COLUMN, "font-semibold")}>{formatCost(group.cost)}</span>
                                </button>
                                {open && group.actions.map((action) => (
                                    <div key={action.id} className="border-b border-[color-mix(in_srgb,var(--vscode-widget-border)_45%,transparent)]">
                                        <button
                                            type="button"
                                            onClick={() => openAction(action)}
                                            title={[action.id, action.statementType, action.status === "estimated" && `${action.gib.toFixed(2)} GiB · ${formatCost(action.cost)}`, "Open its file"].filter(Boolean).join("\n")}
                                            className="group flex items-center gap-2 w-full min-h-[26px] px-3 py-0.5 text-left text-[12.5px] border-0 bg-transparent text-[var(--vscode-foreground)] cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
                                        >
                                            <Kind type={action.type} />
                                            <span className="flex-1 min-w-0 truncate font-mono group-hover:text-[var(--vscode-textLink-foreground)] group-hover:underline">{action.name}</span>
                                            <span className={clsx(ACCURACY_COLUMN, !STATUS_COLOR[action.status] && (action.accuracy === "precise" ? "text-[var(--vscode-descriptionForeground)]" : "text-[var(--vscode-foreground)]"))} style={{ color: STATUS_COLOR[action.status] }} title={action.status === "unknown" ? UNKNOWN_ACCURACY_TOOLTIP : undefined}>
                                                {action.status === "failed" ? "failed" : action.accuracy}
                                            </span>
                                            <span className={clsx(GIB_COLUMN, "text-[var(--vscode-descriptionForeground)]")}>{action.status === "estimated" ? action.gib.toFixed(2) : "—"}</span>
                                            <span className={COST_COLUMN}>{action.status === "estimated" ? formatCost(action.cost) : "—"}</span>
                                        </button>
                                        {action.error && <div className="pl-[66px] pr-3 pb-1.5 text-[11.5px] whitespace-pre-wrap break-words text-[var(--vscode-errorForeground)]">{action.error}</div>}
                                    </div>
                                ))}
                            </section>
                        );
                    })}
                    {groups.length === 0 && <p className="m-0 px-3 py-3 text-xs text-[var(--vscode-descriptionForeground)]">No action matches.</p>}
                </div>
            )}
        </div>

        {actions.length === 0 && !estimateError && !loading && (
            <p className="m-0 pt-3 text-xs text-[var(--vscode-descriptionForeground)]">Select one or more tags and click Estimate Cost to see results.</p>
        )}
    </div>
);
};
