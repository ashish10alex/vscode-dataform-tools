import React, { useEffect, useMemo, useState } from 'react';
import { WebviewState } from '../types';
import { vscode } from '../utils/vscode';
import { Loader2, Info, AlertCircle } from 'lucide-react';
import { DataTable } from '../../components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';

interface CostEstimatorTabProps {
  state: WebviewState;
}

type CostEstimateRow = {
    targetName: string;
    type: string;
    statementType: string;
    totalBytesProcessedAccuracy: string;
    totalGBProcessed: string; // or number? <b>parseFloat</b> was used in previous implementation
    costOfRunningModel: string;
    error?: string;
};

export const CostEstimatorTab: React.FC<CostEstimatorTabProps> = ({ state }) => {
  const [selectedTag, setSelectedTag] = useState<string>(state.selectedTag || "");
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [includeDependents, setIncludeDependents] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
     if (state.selectedTag) {
         setSelectedTag(state.selectedTag);
     }
  }, [state.selectedTag]);

  const handleEstimate = () => {
    if (!selectedTag) {
        return;
    }
    setLoading(true);
    vscode.postMessage({
        command: 'costEstimator',
        value: { selectedTag, includeDependencies, includeDependents }
    });
  };

  useEffect(() => {
      // Clear loading if we get a result or error
       if (state.tagDryRunStatsMeta || state.errorMessage) {
           setLoading(false);
       }
  }, [state.tagDryRunStatsMeta, state.errorMessage]);

  const data = useMemo(() => {
      const list = state.tagDryRunStatsMeta?.tagDryRunStatsList || [];
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
  }, [state.tagDryRunStatsMeta]);
  const currencySymbol = state.currencySymbol || "$";

  const columns = useMemo<ColumnDef<CostEstimateRow>[]>(() => [
      {
          accessorKey: "targetName",
          header: "Target",
      },
      {
          accessorKey: "type",
          header: "Type",
      },
      {
          accessorKey: "statementType",
          header: "Statement type",
      },
      {
          accessorKey: "totalBytesProcessedAccuracy",
          header: "Accuracy",
      },
      {
          accessorKey: "totalGBProcessed",
          header: "GiB proc.",
          cell: ({ getValue }) => {
              const val = parseFloat(getValue() as string);
              return isNaN(val) ? "" : val.toFixed(2);
          },
          footer: (info) => {
              const total = info.table.getFilteredRowModel().rows.reduce((sum, row) => {
                  const val = parseFloat(row.getValue("totalGBProcessed"));
                  return sum + (isNaN(val) ? 0 : val);
              }, 0);
              return total.toFixed(2);
          }
      },
      {
          accessorKey: "costOfRunningModel",
          header: "Cost",
          cell: ({ getValue }) => {
              const val = parseFloat(getValue() as string);
              return isNaN(val) ? "" : `${currencySymbol}${val.toFixed(2)}`;
          },
          footer: (info) => {
               const total = info.table.getFilteredRowModel().rows.reduce((sum, row) => {
                  const val = parseFloat(row.getValue("costOfRunningModel"));
                  return sum + (isNaN(val) ? 0 : val);
              }, 0);
              return `${currencySymbol}${total.toFixed(2)}`;
          }
      },
      {
        accessorKey: "error",
        header: "Error",
        cell: ({ getValue }) => {
            const error = getValue() as string;
            return error ? <span className="text-[var(--vscode-errorForeground)] font-medium">{error}</span> : null; 
        }
      }
  ], [currencySymbol]);

  return (
    <div className="h-full flex flex-col space-y-4">
        <div className="bg-[var(--vscode-sideBar-background)] p-4 rounded-lg border border-[var(--vscode-widget-border)]">
            <h2 className="text-lg font-semibold text-[var(--vscode-foreground)] mb-2">Cost Estimator</h2>
            <p className="text-sm text-[var(--vscode-descriptionForeground)] mb-3">
                Estimate the cost of running models associated with a specific tag.
            </p>

            <details className="mb-5 group">
                <summary className="text-sm text-[var(--vscode-descriptionForeground)] cursor-pointer list-none flex items-center gap-1.5 hover:text-[var(--vscode-foreground)] transition-colors w-fit pb-1">
                    <Info className="w-4 h-4" />
                    <span>How is cost calculated?</span>
                </summary>
                <div className="mt-2 text-xs text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] p-3 rounded">
                    <p className="mb-2">For each model in the tag, we construct a full query and perform a dry run:</p>
                    <ul className="space-y-1.5 ml-1">
                        <li><strong className="font-medium text-[var(--vscode-foreground)]">Table / View:</strong> Pre-operation + Create or replace statement + Main query</li>
                        <li><strong className="font-medium text-[var(--vscode-foreground)]">Partitioned / Clustered Tables:</strong> Pre-operations + Main query</li>
                        <li><strong className="font-medium text-[var(--vscode-foreground)]">Incremental:</strong> Incremental pre-operation query + Create or replace statement + Main query</li>
                        <li><strong className="font-medium text-[var(--vscode-foreground)]">Partitioned / Clustered Incremental:</strong> Incremental pre-operation query + Main query</li>
                        <li><strong className="font-medium text-[var(--vscode-foreground)]">Assertion & Operation:</strong> Main query</li>
                    </ul>
                </div>
            </details>

            <div className="flex items-center gap-4">
                <select 
                    value={selectedTag} 
                    onChange={(e) => setSelectedTag(e.target.value)}
                    className="bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] text-sm rounded px-3 py-2 focus:ring-1 focus:ring-[var(--vscode-focusBorder)] outline-none min-w-[200px] transition-colors"
                >
                    <option value="" disabled className="bg-[var(--vscode-input-background)]">Select a tag</option>
                    {state.dataformTags?.map(tag => (
                        <option key={tag} value={tag} className="bg-[var(--vscode-input-background)]">{tag}</option>
                    ))}
                </select>

                <button 
                    onClick={handleEstimate} 
                    disabled={!selectedTag || loading}
                    className="bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] px-4 py-2 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center transition-colors"
                >
                    {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Estimate Cost
                </button>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-[var(--vscode-foreground)] mt-4">
                <label className="flex items-center cursor-pointer space-x-2">
                    <input type="checkbox" checked={includeDependencies} onChange={e => setIncludeDependencies(e.target.checked)} className="form-checkbox h-4 w-4 bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] rounded" />
                    <span>Include Dependencies</span>
                </label>
                <label className="flex items-center cursor-pointer space-x-2">
                    <input type="checkbox" checked={includeDependents} onChange={e => setIncludeDependents(e.target.checked)} className="form-checkbox h-4 w-4 bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] rounded" />
                    <span>Include Dependents</span>
                </label>
            </div>

            {(state.errorMessage || state.tagDryRunStatsMeta?.error) && (
                <div className="mt-4 p-3 bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)] rounded flex items-start gap-2 text-sm text-[var(--vscode-errorForeground)]">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                        <div className="font-semibold mb-0.5">Estimation Failed</div>
                        <div className="opacity-90">
                            {state.errorMessage || state.tagDryRunStatsMeta?.error?.message}
                        </div>
                    </div>
                </div>
            )}
        </div>
        
        <div className="flex-1 overflow-hidden">
             {data && data.length > 0 ? (
                <DataTable columns={columns} data={data} searchPlaceholder="Filter costs..." />
             ) : (
                <div className="text-center text-[var(--vscode-descriptionForeground)] mt-8">
                     {!state.errorMessage && !state.tagDryRunStatsMeta?.error && (
                         "Select a tag and click Estimate Cost to see results."
                     )}
                 </div>
             )}
        </div>
    </div>
);
};
