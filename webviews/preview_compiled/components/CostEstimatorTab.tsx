import React, { useEffect, useRef, useState } from 'react';
import { WebviewState } from '../types';
import { vscode } from '../utils/vscode';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator.min.css';
import { Loader2 } from 'lucide-react';

interface CostEstimatorTabProps {
  state: WebviewState;
}

export const CostEstimatorTab: React.FC<CostEstimatorTabProps> = ({ state }) => {
  const tableRef = useRef<HTMLDivElement>(null);
  const tabulatorRef = useRef<any | null>(null);
  const [selectedTag, setSelectedTag] = useState<string>(state.selectedTag || "");
  const [loading, setLoading] = useState(false);

  const handleEstimate = () => {
    if (!selectedTag) return;
    setLoading(true);
    vscode.postMessage({
        command: 'costEstimator',
        value: { selectedTag }
    });
    // Loading state is ideally controlled by props, but we set it here for immediate feedback
    // It should be cleared when `state` updates with new data
  };

  useEffect(() => {
      // Clear loading if we get a result or error
       if (state.tagDryRunStatsMeta || state.errorMessage) {
           setLoading(false);
       }
  }, [state.tagDryRunStatsMeta, state.errorMessage]);


  useEffect(() => {
    if (state.tagDryRunStatsMeta?.tagDryRunStatsList && tableRef.current) {
        if(tabulatorRef.current){
            tabulatorRef.current.destroy();
        }

        const currencySymbol = state.currencySymbol || "$";

        tabulatorRef.current = new Tabulator(tableRef.current, {
            data: state.tagDryRunStatsMeta.tagDryRunStatsList,
            layout: "fitColumns",
            columns: [
                {title: "Target", field: "targetName", headerFilter: "input" },
                {title: "Type", field: "type", headerFilter: "input" },
                {title: "Statement type", field: "statementType", headerFilter: "input" },
                {title: "Accuracy", field: "totalBytesProcessedAccuracy", headerFilter: "input" },
                {
                    title: "GiB proc.",
                    field: "totalGBProcessed",
                    formatter: (cell: any) => {
                        const val = parseFloat(cell.getValue());
                        return isNaN(val) ? "" : val.toFixed(2);
                    },
                    bottomCalc: "sum",
                    bottomCalcFormatter: (cell: any) => {
                        const val = parseFloat(cell.getValue());
                        return isNaN(val) ? "" : val.toFixed(2);
                    }
                },
                {
                    title: "Cost",
                    field: "costOfRunningModel",
                    formatter: "money",
                    formatterParams: { symbol: currencySymbol, precision: 2 },
                    bottomCalc: "sum",
                    bottomCalcFormatter: "money",
                    bottomCalcFormatterParams: { symbol: currencySymbol, precision: 2 }
                }
            ],
            height: "100%",
        });
    }
  }, [state.tagDryRunStatsMeta, state.currencySymbol]);

  return (
    <div className="h-full flex flex-col space-y-4">
        <div className="bg-zinc-800/50 p-4 rounded border border-zinc-700">
            <h2 className="text-lg font-semibold text-zinc-200 mb-2">Cost Estimator</h2>
            <p className="text-sm text-zinc-400 mb-4">
                Estimate the cost of running models associated with a specific tag.
            </p>

            <div className="flex items-center gap-4">
                <select 
                    value={selectedTag} 
                    onChange={(e) => setSelectedTag(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none min-w-[200px]"
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
        
        <div ref={tableRef} className="flex-1 overflow-hidden" />
    </div>
  );
};
