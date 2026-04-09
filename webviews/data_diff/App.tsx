import React, { useState, useEffect } from "react";
import { vscode } from "./utils/vscode";
import { diffWords } from "diff";
import * as RadixTabs from "@radix-ui/react-tabs";
import { CodeBlock } from "../components/CodeBlock";

export default function App() {
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [tablePrefix, setTablePrefix] = useState("");
  const [primaryKeysMap, setPrimaryKeysMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [diffResults, setDiffResults] = useState<any[]>([]);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [isDiffing, setIsDiffing] = useState(false);
  const [diffingFiles, setDiffingFiles] = useState<Set<string>>(new Set());
  const [hideUnchangedCols, setHideUnchangedCols] = useState(true);
  const [previewModels, setPreviewModels] = useState<any[] | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "init") {
        setSourceBranch(message.data.currentBranch);
        setAllBranches(message.data.branches);
        setIsLoading(false);
      } else if (message.command === "diffComplete") {
        const results: any[] = message.data.results;
        if (results.length === 1) {
          // Single model — merge into existing results
          const newResult = results[0];
          setDiffResults(prev => {
            const idx = prev.findIndex(r => r.file === newResult.file);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = newResult;
              return next;
            }
            return [...prev, newResult];
          });
          setDiffingFiles(prev => {
            const next = new Set(prev);
            next.delete(newResult.file);
            return next;
          });
        } else {
          setDiffResults(results);
          setIsDiffing(false);
        }
        setDiffError(null);
      } else if (message.command === "diffError") {
        setDiffError(message.data);
        setIsDiffing(false);
        setDiffingFiles(new Set());
      } else if (message.command === "diffModelsPreview") {
        setPreviewModels(message.data);
      }
    };
    window.addEventListener("message", handleMessage);

    vscode.postMessage({ command: "webviewReady" });

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (sourceBranch && targetBranch && tablePrefix) {
      setPreviewModels(null);
      vscode.postMessage({
        command: "previewAffectedModels",
        data: { sourceBranch, targetBranch, tablePrefix },
      });
    }
  }, [sourceBranch, targetBranch, tablePrefix]);

  const handleRunDiff = () => {
    if (!tablePrefix || !targetBranch) { return; }
    setIsDiffing(true);
    setDiffResults([]);
    setDiffError(null);
    vscode.postMessage({
      command: "runDataDiff",
      data: { sourceBranch, targetBranch, tablePrefix, primaryKeysMap },
    });
  };

  const handleRunSingleDiff = (file: string) => {
    setDiffingFiles(prev => new Set(prev).add(file));
    setDiffError(null);
    vscode.postMessage({
      command: "runSingleModelDiff",
      data: {
        sourceBranch,
        targetBranch,
        tablePrefix,
        file,
        primaryKeys: primaryKeysMap[file] || '',
      },
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
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {previewModels && previewModels.length > 0 && (
          <div className="border border-vscode-panel-border bg-vscode-editor-background rounded text-sm p-4">
            <h3 className="font-semibold mb-4 text-base">Models to Compare ({previewModels.length})</h3>
            <div className="overflow-x-auto mb-2">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-vscode-panel-border text-vscode-descriptionForeground">
                    <th className="text-left py-2 pr-3 font-semibold">File</th>
                    <th className="text-left py-2 pr-3 font-semibold">Target (A)</th>
                    <th className="text-left py-2 pr-3 font-semibold">Source (B)</th>
                    <th className="text-left py-2 pr-3 font-semibold">Primary Keys</th>
                    <th className="text-left py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {previewModels.map((model) => {
                    const isFileDiffing = diffingFiles.has(model.file);
                    return (
                      <tr key={model.file} className="border-b border-vscode-panel-border/40 last:border-0">
                        <td className="py-2 pr-3 font-mono break-all max-w-[120px]">{model.file.split('/').pop()}</td>
                        <td className="py-2 pr-3 font-mono text-vscode-descriptionForeground break-all max-w-[160px]">{model.baseTableName.split('.').pop()}</td>
                        <td className="py-2 pr-3 font-mono text-vscode-descriptionForeground break-all max-w-[160px]">{model.featTableName.split('.').pop()}</td>
                        <td className="py-2 pr-3 min-w-[120px]">
                          <input
                            className="w-full px-1.5 py-1 border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground text-xs rounded"
                            type="text"
                            value={primaryKeysMap[model.file] || ''}
                            onChange={(e) => setPrimaryKeysMap(prev => ({ ...prev, [model.file]: e.target.value }))}
                            placeholder="e.g. ORG_ID"
                          />
                        </td>
                        <td className="py-2">
                          <button
                            className="px-2 py-1 bg-vscode-button-background text-vscode-button-foreground rounded hover:bg-vscode-button-hoverBackground disabled:opacity-50 whitespace-nowrap text-xs"
                            disabled={isFileDiffing || isDiffing}
                            onClick={() => handleRunSingleDiff(model.file)}
                          >
                            {isFileDiffing ? "..." : "Diff"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {previewModels && previewModels.length === 0 && (
          <div className="p-3 border border-vscode-panel-border bg-vscode-editor-background rounded text-sm text-yellow-500 max-w-lg">
            No modified models found between the selected branches that can be compared.
          </div>
        )}

        <div className="max-w-lg">
            <button
            className="w-full bg-vscode-button-background text-vscode-button-foreground p-2 rounded hover:bg-vscode-button-hoverBackground disabled:opacity-50"
            disabled={!tablePrefix || !targetBranch || isDiffing || (previewModels?.length === 0)}
            onClick={handleRunDiff}
            >
            {isDiffing ? "Comparing Data..." : "Compare All"}
            </button>
        </div>
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
                  <RadixTabs.Root defaultValue="summary" className="w-full">
                    <RadixTabs.List className="flex border-b border-[var(--vscode-widget-border)] mb-4">
                      <RadixTabs.Trigger
                        value="summary"
                        className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px"
                      >
                        Summary
                      </RadixTabs.Trigger>
                      <RadixTabs.Trigger
                        value="query"
                        className="px-4 py-2 text-sm font-medium text-[var(--vscode-foreground)] opacity-60 border-b-2 border-transparent data-[state=active]:opacity-100 data-[state=active]:border-[var(--vscode-button-background)] transition-colors -mb-px"
                      >
                        Comparison Query
                      </RadixTabs.Trigger>
                    </RadixTabs.List>

                    <RadixTabs.Content value="summary">
                      <div className="mb-3 flex flex-col gap-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-sm text-vscode-descriptionForeground shrink-0">Target Table:</span>
                          <code className="bg-vscode-editor-background px-1.5 py-0.5 rounded text-xs break-all">{result.baseTableFullName || result.baseTableName}</code>
                          {result.baseLastModified && <span className="text-xs text-vscode-descriptionForeground shrink-0">updated {new Date(result.baseLastModified).toLocaleString()}</span>}
                        </div>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-sm text-vscode-descriptionForeground shrink-0">Source Table:</span>
                          <code className="bg-vscode-editor-background px-1.5 py-0.5 rounded text-xs break-all">{result.featTableFullName || result.featTableName}</code>
                          {result.featLastModified && <span className="text-xs text-vscode-descriptionForeground shrink-0">updated {new Date(result.featLastModified).toLocaleString()}</span>}
                        </div>
                      </div>

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
                     {result.schemaAddedCols?.length > 0 && (
                         <p className="text-sm mt-2 text-green-400">Schema Added: {result.schemaAddedCols.join(', ')}</p>
                     )}
                     {result.schemaRemovedCols?.length > 0 && (
                         <p className="text-sm mt-1 text-red-400">Schema Removed: {result.schemaRemovedCols.join(', ')}</p>
                     )}
                     {result.isPairedDiff ? (
                         Object.keys(result.changedColumns || {}).length > 0 && (
                             <div className="mt-4">
                                <h4 className="font-semibold text-sm mb-2 text-vscode-descriptionForeground">Modified Columns (Rows Changed)</h4>
                                <div className="flex flex-wrap gap-2">
                                   {Object.entries(result.changedColumns).sort((a: any, b: any) => b[1] - a[1]).map(([col, count]: [string, any]) => (
                                       <div key={col} className="bg-vscode-editor-background px-2 py-1 rounded text-xs border border-vscode-panel-border">
                                           {col} <span className="text-vscode-descriptionForeground ml-1 opacity-70">({count})</span>
                                       </div>
                                   ))}
                                </div>
                             </div>
                         )
                     ) : (
                         (result.modifiedCount ?? 0) > 0 && (
                             <div className="mt-4 p-3 bg-vscode-editor-background border border-yellow-900/30 rounded flex gap-2 text-vscode-descriptionForeground">
                                 <span className="text-yellow-500">⚠️</span>
                                 <span className="text-xs">
                                    Granular column-level variation metrics are unavailable because this model lacks a <code className="text-yellow-600 bg-yellow-900/10 px-1 rounded">uniqueKey</code> definition. Add a unique key in your SQLX config to unlock column diffs!
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
            ))}
          </div>
        ) : (
          !isDiffing && <p className="text-vscode-descriptionForeground text-sm italic">Run comparison to see results here.</p>
        )}
      </div>
    </div>
  );
}
