import React, { useState, useEffect } from "react";
import { vscode } from "./utils/vscode";
import { diffWords } from "diff";

export default function App() {
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [tablePrefix, setTablePrefix] = useState("");
  const [primaryKeys, setPrimaryKeys] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [diffResults, setDiffResults] = useState<any[]>([]);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [isDiffing, setIsDiffing] = useState(false);
  const [hideUnchangedCols, setHideUnchangedCols] = useState(true);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "init") {
        setSourceBranch(message.data.currentBranch);
        setAllBranches(message.data.branches);
        setIsLoading(false);
      } else if (message.command === "diffComplete") {
        setDiffResults(message.data.results);
        setIsDiffing(false);
        setDiffError(null);
      } else if (message.command === "diffError") {
        setDiffError(message.data);
        setIsDiffing(false);
      }
    };
    window.addEventListener("message", handleMessage);

    vscode.postMessage({ command: "webviewReady" });

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleRunDiff = () => {
    if (!tablePrefix || !targetBranch) { return; }
    setIsDiffing(true);
    setDiffResults([]);
    setDiffError(null);
    vscode.postMessage({
      command: "runDataDiff",
      data: { sourceBranch, targetBranch, tablePrefix, primaryKeys },
    });
  };

  if (isLoading) {
    return <div className="p-4 text-vscode-foreground">Loading branch information...</div>;
  }

  return (
    <div className="p-4 bg-vscode-background text-vscode-foreground font-sans">
      <h1 className="text-xl font-bold mb-4">Branch Data Diff</h1>
      <div className="flex flex-col gap-4 max-w-lg">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-sm">Source Branch</span>
          <input
            className="p-2 border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground"
            type="text"
            value={sourceBranch}
            disabled
          />
        </label>
        
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-sm">Target Branch</span>
          <select
            className="p-2 border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground"
            value={targetBranch}
            onChange={(e) => setTargetBranch(e.target.value)}
          >
            <option value="" disabled>Select target branch</option>
            {allBranches.map((branch) => (
              <option key={branch} value={branch}>{branch}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold text-sm">Target Table Prefix (<span className="text-xs font-mono">--table-prefix</span>)</span>
          <input
            className="p-2 border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground"
            type="text"
            value={tablePrefix}
            onChange={(e) => setTablePrefix(e.target.value)}
            placeholder="e.g. feat_123"
          />
        </label>
        
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-sm">Primary Keys (comma separated)</span>
          <input
            className="p-2 border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground"
            type="text"
            value={primaryKeys}
            onChange={(e) => setPrimaryKeys(e.target.value)}
            placeholder="e.g. ORG_ID (leave blank to auto-detect)"
          />
        </label>

        <button
          className="bg-vscode-button-background text-vscode-button-foreground p-2 rounded hover:bg-vscode-button-hoverBackground disabled:opacity-50 mt-2"
          disabled={!tablePrefix || !targetBranch || isDiffing}
          onClick={handleRunDiff}
        >
          {isDiffing ? "Comparing Data..." : "Compare Data"}
        </button>
      </div>
      
      <div className="mt-8 border-t border-vscode-panel-border pt-4">
        <h2 className="text-lg font-semibold mb-4">Diff Results</h2>
        {diffError && <div className="text-red-500 mb-4">{diffError}</div>}
        
        {diffResults.length > 0 ? (
          <div className="flex flex-col gap-6">
            {diffResults.map((result, idx) => (
              <div key={idx} className="border border-vscode-editorGroup-border p-4 rounded">
                <h3 className="font-bold mb-2 break-all">{result.file}</h3>
                {result.error ? (
                  <p className="text-red-400">{result.error}</p>
                ) : (
                  <div>
                     <p className="mb-2">Target Table: <code className="bg-vscode-editor-background p-1 rounded">{result.baseTableName}</code></p>
                     <p className="mb-2">Source Table: <code className="bg-vscode-editor-background p-1 rounded">{result.featTableName}</code></p>
                     
                     <div className="flex gap-4 mb-4">
                        <div className="bg-green-900/40 text-green-400 px-3 py-1 rounded">
                           Added: {result.addedCount}
                        </div>
                        <div className="bg-red-900/40 text-red-400 px-3 py-1 rounded">
                           Removed: {result.removedCount}
                        </div>
                        {result.modifiedCount !== undefined && (
                           <div className="bg-blue-900/40 text-blue-400 px-3 py-1 rounded">
                              Modified: {result.modifiedCount}
                           </div>
                        )}
                     </div>
                     
                     {result.rows && result.rows.length > 0 && result.isPairedDiff && (() => {
                         const visibleCommonCols = hideUnchangedCols ? result.commonColNames.filter((col: string) => {
                             return result.rows.some((r: any) => {
                                 const oldStr = String(r[`base_${col}`] ?? 'NULL');
                                 const newStr = String(r[`feat_${col}`] ?? 'NULL');
                                 return oldStr !== newStr;
                             });
                         }) : result.commonColNames;
                         
                         return (
                           <div className="overflow-x-auto max-h-96 overflow-y-auto mt-4 bg-vscode-editor-background">
                             <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-vscode-editor-selectionBackground text-vscode-editor-foreground sticky top-0 z-10">
                                   <tr>
                                      <th className="p-2 border-b border-vscode-panel-border z-20">Status</th>
                                      {result.pkCols?.map((pk: string) => (
                                          <th key={`pk-${pk}`} className="p-2 border-b border-vscode-panel-border bg-vscode-editor-selectionBackground z-20 sticky left-0 shadow-[1px_0_0_var(--vscode-panel-border)]">{pk}</th>
                                      ))}
                                      {visibleCommonCols?.map((col: string) => (
                                         result.pkCols?.includes(col) ? null : 
                                         <th key={`col-${col}`} colSpan={2} className="p-2 border-b border-vscode-panel-border text-center border-l border-vscode-panel-border">
                                              {col}
                                         </th>
                                      ))}
                                   </tr>
                                   <tr>
                                      <th className="border-b border-vscode-panel-border"></th>
                                      {result.pkCols?.map((pk: string) => (<th key={`subpk-${pk}`} className="border-b border-vscode-panel-border bg-vscode-editor-selectionBackground sticky left-0 shadow-[1px_0_0_var(--vscode-panel-border)] z-20"></th>))}
                                      {visibleCommonCols?.map((col: string) => (
                                         result.pkCols?.includes(col) ? null : 
                                         <React.Fragment key={`subcol-${col}`}>
                                             <th className="p-1 border-b border-vscode-panel-border border-l border-vscode-panel-border text-xs text-vscode-descriptionForeground font-normal">Base (A)</th>
                                             <th className="p-1 border-b border-vscode-panel-border text-xs text-vscode-descriptionForeground font-normal">Feat (B)</th>
                                         </React.Fragment>
                                      ))}
                                   </tr>
                                </thead>
                            <tbody>
                               {result.rows.map((r: any, rIdx: number) => {
                                  let bgClass = "";
                                  if (r._diff_status === 'Added') bgClass = "bg-green-900/10";
                                  else if (r._diff_status === 'Removed') bgClass = "bg-red-900/10";
                                  else if (r._diff_status === 'Modified') bgClass = "bg-blue-900/5";

                                  return (
                                    <tr key={rIdx} className={`border-b border-vscode-panel-border hover:bg-vscode-list-hoverBackground ${bgClass}`}>
                                      <td className={`p-2 font-semibold ${r._diff_status === 'Added' ? 'text-green-500' : r._diff_status === 'Removed' ? 'text-red-500' : 'text-blue-400'}`}>
                                          {r._diff_status}
                                      </td>
                                      
                                      {result.pkCols?.map((pk: string) => (
                                          <td key={`v-pk-${pk}`} className={`p-2 font-mono bg-vscode-editor-background sticky left-0 shadow-[1px_0_0_var(--vscode-panel-border)] z-10 hover:bg-inherit`}>
                                            {r._pk || String(r[`base_${pk}`] || r[`feat_${pk}`] || 'NULL')}
                                          </td>
                                      ))}

                                      {visibleCommonCols?.map((col: string) => {
                                          if (result.pkCols?.includes(col)) return null;
                                          
                                          const oldStr = String(r[`base_${col}`] ?? 'NULL');
                                          const newStr = String(r[`feat_${col}`] ?? 'NULL');
                                          
                                          if (oldStr === newStr) {
                                              return (
                                                  <React.Fragment key={`v-col-${col}`}>
                                                      <td className="p-2 border-l border-vscode-panel-border text-vscode-descriptionForeground opacity-60 truncate max-w-[200px]" title={oldStr}>{oldStr}</td>
                                                      <td className="p-2 text-vscode-descriptionForeground opacity-60 truncate max-w-[200px]" title={newStr}>{newStr}</td>
                                                  </React.Fragment>
                                              );
                                          }

                                          const diffs = diffWords(oldStr, newStr);
                                          const baseOutput = diffs.filter(d => !d.added).map((d, i) => 
                                              d.removed ? <span key={i} className="bg-red-500/40 text-red-100 rounded px-[2px]">{d.value}</span> : <span key={i}>{d.value}</span>
                                          );
                                          const featOutput = diffs.filter(d => !d.removed).map((d, i) => 
                                              d.added ? <span key={i} className="bg-green-500/40 text-green-100 rounded px-[2px]">{d.value}</span> : <span key={i}>{d.value}</span>
                                          );

                                          return (
                                              <React.Fragment key={`v-col-${col}`}>
                                                  <td className="p-2 border-l border-vscode-panel-border max-w-[300px] text-wrap">{r._diff_status !== 'Added' && baseOutput}</td>
                                                  <td className="p-2 max-w-[300px] text-wrap">{r._diff_status !== 'Removed' && featOutput}</td>
                                              </React.Fragment>
                                          );
                                      })}
                                    </tr>
                                  );
                               })}
                            </tbody>
                         </table>
                       </div>
                     );})()}

                     {result.rows && result.rows.length > 0 && !result.isPairedDiff && (
                       <div className="overflow-x-auto max-h-[800px] overflow-y-auto mt-4 bg-vscode-editor-background shadow border border-vscode-panel-border">
                               {(() => {
                                   const ObjectKeys = Object.keys(result.rows[0] || {}).filter(k => k !== '_diff_status');
                                   const parsedRows: any[] = [];
                                   let i = 0;
                                   while (i < result.rows.length) {
                                      const r = result.rows[i];
                                      if (r._diff_status === 'Modified (-)') {
                                          const nextR = result.rows[i + 1];
                                          if (nextR && nextR._diff_status === 'Modified (+)') {
                                              parsedRows.push({ _type: 'Modified', oldRow: r, newRow: nextR });
                                              i += 2;
                                              continue;
                                          }
                                      }
                                      parsedRows.push({ _type: r._diff_status, oldRow: r, newRow: r });
                                      i++;
                                   }

                                   const changedColumns = new Set<string>();
                                   parsedRows.forEach(pr => {
                                       const isAdded = pr._type === 'Added';
                                       const isRemoved = pr._type === 'Removed';
                                       ObjectKeys.forEach(k => {
                                            const valOldOrig = isAdded ? null : pr.oldRow[k];
                                            const valNewOrig = isRemoved ? null : pr.newRow[k];
                                            const valOldCompare = valOldOrig !== null && typeof valOldOrig === 'object' && 'value' in valOldOrig ? valOldOrig.value : valOldOrig;
                                            const valNewCompare = valNewOrig !== null && typeof valNewOrig === 'object' && 'value' in valNewOrig ? valNewOrig.value : valNewOrig;
                                            if (valOldCompare !== valNewCompare) {
                                                changedColumns.add(k);
                                            }
                                       });
                                   });

                                   const visibleColumns = hideUnchangedCols ? ObjectKeys.filter(k => changedColumns.has(k)) : ObjectKeys;

                                   const renderValue = (v: any) => {
                                      if (v === null || v === undefined) { return <span className="text-vscode-descriptionForeground italic opacity-50">null</span>; }
                                      if (typeof v === 'object') {
                                          if ('value' in v) { return String(v.value); }
                                          return JSON.stringify(v);
                                      }
                                      return String(v);
                                   };

                                   return (
                                     <>
                                       <table className="w-full text-left text-sm whitespace-nowrap">
                                          <thead className="bg-vscode-editor-selectionBackground text-vscode-editor-foreground sticky top-0 z-10">
                                             <tr>
                                                <th rowSpan={2} className="p-2 border-b border-r border-vscode-panel-border bg-vscode-editor-selectionBackground">Diff Status</th>
                                                {visibleColumns.map(k => (
                                                    <th key={k} colSpan={2} className="p-2 border-b border-r border-vscode-panel-border text-center bg-vscode-editor-selectionBackground">{k}</th>
                                                ))}
                                             </tr>
                                             <tr>
                                                {visibleColumns.map(k => (
                                                    <React.Fragment key={k + '_sub'}>
                                                        <th className="p-1 px-4 border-b border-vscode-panel-border text-red-300 bg-red-900/30 text-center text-xs font-mono">A (Target)</th>
                                                        <th className="p-1 px-4 border-b border-r border-vscode-panel-border text-green-300 bg-green-900/30 text-center text-xs font-mono">B (Source)</th>
                                                    </React.Fragment>
                                                ))}
                                             </tr>
                                          </thead>
                                          <tbody>
                                             {parsedRows.map((pr: any, rIdx: number) => {
                                                 const isAdded = pr._type === 'Added';
                                                 const isRemoved = pr._type === 'Removed';
                                                 
                                                 const rawCss = isAdded ? 'bg-green-900/10' : isRemoved ? 'bg-red-900/10' : 'bg-transparent hover:bg-vscode-list-hoverBackground';
                                                 
                                                 return (
                                                   <tr key={rIdx} className={`border-b border-vscode-panel-border ${rawCss}`}>
                                                     <td className={`p-2 font-bold border-r border-vscode-panel-border ${isAdded ? 'text-green-400' : isRemoved ? 'text-red-400' : 'text-blue-400'}`}>
                                                        {pr._type}
                                                     </td>
                                                     {visibleColumns.map((k: string) => {
                                                         const valOldOrig = isAdded ? null : pr.oldRow[k];
                                                         const valNewOrig = isRemoved ? null : pr.newRow[k];
                                                         
                                                         const valOldCompare = valOldOrig !== null && typeof valOldOrig === 'object' && 'value' in valOldOrig ? valOldOrig.value : valOldOrig;
                                                         const valNewCompare = valNewOrig !== null && typeof valNewOrig === 'object' && 'value' in valNewOrig ? valNewOrig.value : valNewOrig;
                                                         
                                                         const valOld = renderValue(valOldOrig);
                                                         const valNew = renderValue(valNewOrig);
                                                         
                                                         const isDiff = valOldCompare !== valNewCompare;
                                                         
                                                         const oldClass = isAdded ? "bg-vscode-editor-background opacity-20" : (isDiff ? "bg-red-900/40 text-red-300 font-semibold line-through decoration-red-400/50" : "");
                                                         const newClass = isRemoved ? "bg-vscode-editor-background opacity-20" : (isDiff ? "bg-green-900/40 text-green-300 font-bold" : "");
                                                         
                                                         return (
                                                             <React.Fragment key={k}>
                                                                 <td className={`p-2 border-r border-vscode-editorGroup-border ${oldClass}`}>{valOld}</td>
                                                                 <td className={`p-2 border-r border-vscode-panel-border ${newClass}`}>{valNew}</td>
                                                             </React.Fragment>
                                                         );
                                                     })}
                                                   </tr>
                                                 );
                                             })}
                                          </tbody>
                                       </table>
                                     </>
                                   );
                               })()}
                       </div>
                     )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          !isDiffing && <p className="text-vscode-descriptionForeground text-sm italic">Run comparison to see results here.</p>
        )}
      </div>
    </div>
  );
}
