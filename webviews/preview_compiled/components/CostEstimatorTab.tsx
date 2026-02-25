import React, { useEffect, useMemo, useState } from 'react';
import { WebviewState } from '../types';
import { vscode } from '../utils/vscode';
import { Loader2, Info } from 'lucide-react';
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
    totalGBProcessed: string; // or number? Tabulator had parseFloat
    costOfRunningModel: string;
    error?: string;
};

export const CostEstimatorTab: React.FC<CostEstimatorTabProps> = ({ state }) => {
  const [selectedTag, setSelectedTag] = useState<string>(state.selectedTag || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
     if (state.selectedTag) {
         setSelectedTag(state.selectedTag);
     }
  }, [state.selectedTag]);

  const handleEstimate = () => {
    if (!selectedTag) return;
    setLoading(true);
    vscode.postMessage({
        command: 'costEstimator',
        value: { selectedTag }
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
          if (aHasError && !bHasError) return -1;
          if (!aHasError && bHasError) return 1;
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
            return error ? <span className="text-red-500 font-medium">{error}</span> : null; 
        }
      }
  ], [currencySymbol]);

  return (
    <div className="h-full flex flex-col space-y-4">
        <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded border border-zinc-200 dark:border-zinc-700">
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Cost Estimator</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                Estimate the cost of running models associated with a specific tag.
            </p>

            <details className="mb-5 group">
                <summary className="text-sm text-zinc-500 dark:text-zinc-400 cursor-pointer list-none flex items-center gap-1.5 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors w-fit pb-1">
                    <Info className="w-4 h-4" />
                    <span>How is cost calculated?</span>
                </summary>
                <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3 rounded">
                    <p className="mb-2">For each model in the tag, we construct a full query and perform a dry run:</p>
                    <ul className="space-y-1.5 ml-1">
                        <li><strong className="font-medium text-zinc-700 dark:text-zinc-300">Table / View:</strong> Pre-operation + Create or replace statement + Main query</li>
                        <li><strong className="font-medium text-zinc-700 dark:text-zinc-300">Partitioned / Clustered Tables:</strong> Pre-operations + Main query</li>
                        <li><strong className="font-medium text-zinc-700 dark:text-zinc-300">Incremental:</strong> Incremental pre-operation query + Create or replace statement + Main query</li>
                        <li><strong className="font-medium text-zinc-700 dark:text-zinc-300">Partitioned / Clustered Incremental:</strong> Incremental pre-operation query + Main query</li>
                        <li><strong className="font-medium text-zinc-700 dark:text-zinc-300">Assertion & Operation:</strong> Main query</li>
                    </ul>
                </div>
            </details>

            <div className="flex items-center gap-4">
                <select 
                    value={selectedTag} 
                    onChange={(e) => setSelectedTag(e.target.value)}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-sm rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none min-w-[200px]"
                >
                    <option value="" disabled>Select a tag</option>
                    {state.dataformTags?.map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                    ))}
                </select>

                <button 
                    onClick={handleEstimate} 
                    disabled={!selectedTag || loading}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                    {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Estimate Cost
                </button>
            </div>
        </div>
        
        <div className="flex-1 overflow-hidden">
             {data && data.length > 0 ? (
                <DataTable columns={columns} data={data} searchPlaceholder="Filter costs..." />
             ) : (
                 <div className="text-center text-zinc-400 dark:text-zinc-500 mt-8">
                     {state.errorMessage ? (
                         <span className="text-red-500 dark:text-red-400">{state.errorMessage}</span>
                     ) : (
                         "Select a tag and click Estimate Cost to see results."
                     )}
                 </div>
             )}
        </div>
    </div>
  );
};
