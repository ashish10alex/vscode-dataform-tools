import React from 'react';
import {
  ChevronRight,
  ChevronDown,
  Play,
  Network,
  ListTree,
  Eye,
  Wand2,
  ShieldCheck,
  Settings,
  GitCompare,
  GitCompareArrows,
} from 'lucide-react';

interface SkeletonLoaderProps {
  type?: 'default' | 'config';
  mode?: 'cli' | 'api';
}

// Placeholder bar standing in for text that has not arrived yet.
const Bar: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded bg-[var(--vscode-foreground)] opacity-10 ${className}`} />
);

const SkeletonSwitch: React.FC<{ label: string }> = ({ label }) => (
  <div className="inline-flex items-center gap-1.5 px-1.5 py-1 text-xs text-[var(--vscode-foreground)] opacity-50">
    <span className="relative inline-block w-[30px] h-4 shrink-0 rounded-full bg-[var(--vscode-foreground)] opacity-40" />
    {label}
  </div>
);

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({ type = 'default', mode = 'cli' }) => {
  const modeLabel = mode === 'api' ? 'API' : 'CLI';
  if (type === 'config') {
    return (
      <div className="animate-pulse space-y-8">
        {[0, 1].map((table) => (
          <div key={table}>
            <div className="text-sm font-semibold mb-4 px-1 flex items-center opacity-40">
              <Settings className="w-4 h-4 mr-2" />
              <Bar className="h-3.5 w-32" />
            </div>
            <div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] rounded-md overflow-hidden">
              <div className="flex px-4 py-2 bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)]">
                <Bar className="h-3 w-16 mr-[calc(33%-4rem)]" />
                <Bar className="h-3 w-12" />
              </div>
              <div className="divide-y divide-[var(--vscode-widget-border)]">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex px-4 py-2.5">
                    <div className="w-1/3"><Bar className="h-3 w-3/4" /></div>
                    <Bar className="h-3 w-1/3" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      {/* Filename + Compile Time + Format/Lint */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-[30px] w-56 max-w-[50%] rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] flex items-center px-2">
          <Bar className="h-3 w-full" />
        </div>
        <Bar className="h-3 w-32" />
        <div className="flex-grow"></div>
        <div className="flex items-center px-3 py-1.5 text-xs rounded bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] opacity-50">
          <Wand2 className="w-3 h-3 mr-1.5" /> Format
        </div>
        <div className="flex items-center px-3 py-1.5 text-xs rounded bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] opacity-50">
          <ShieldCheck className="w-3 h-3 mr-1.5" /> Lint
        </div>
      </div>

      {/* Model card */}
      <div className="relative bg-[var(--vscode-sideBar-background)] px-4 pt-7 pb-4 rounded-xl border border-[var(--vscode-widget-border)]/60 flex flex-col space-y-2">
        <Bar className="absolute top-2 left-2 h-4 w-12" />
        <Bar className="absolute top-2 right-2 h-4 w-28" />
        <div className="flex items-center gap-2">
          <Bar className="w-4 h-4" />
          <Bar className="h-3.5 w-2/3" />
        </div>
      </div>

      {/* Data Lineage */}
      <div className="bg-[var(--vscode-sideBar-background)] rounded-xl border border-[var(--vscode-widget-border)]/60 overflow-hidden">
        <div className="flex items-center px-4 py-3 opacity-50">
          <ChevronRight className="w-4 h-4 mr-2 text-zinc-400" />
          <span className="font-semibold text-[var(--vscode-foreground)]">Data Lineage</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* Compiler Overrides */}
        <div className="pb-4 border-b border-[var(--vscode-widget-border)]/40">
          <div className="flex items-center py-2 opacity-50">
            <ChevronRight className="w-4 h-4 mr-2 text-zinc-400" />
            <span className="font-semibold text-[var(--vscode-foreground)]">Compiler Overrides</span>
          </div>
        </div>

        {/* Explore & inspect */}
        <div className="flex flex-wrap items-center gap-2 opacity-50">
          <div className="inline-flex rounded border border-[var(--vscode-widget-border)] overflow-hidden text-sm text-[var(--vscode-foreground)]">
            <div className="px-3 py-1.5 flex items-center"><Network className="w-4 h-4 mr-1.5" /> Graph</div>
            <div className="px-3 py-1.5 flex items-center border-l border-[var(--vscode-widget-border)]"><ListTree className="w-4 h-4 mr-1.5" /> Inspector</div>
          </div>
          <div className="px-3 py-1.5 rounded text-sm flex items-center bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)]">
            <Eye className="w-4 h-4 mr-1.5" /> Preview Data
          </div>
          <div className="px-3 py-1.5 rounded text-sm flex items-center bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)]">
            <GitCompareArrows className="w-4 h-4 mr-1.5" /> Column impact
          </div>
        </div>

        {/* Run controls */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 pt-3 border-t border-[var(--vscode-widget-border)]">
          <div className="inline-flex opacity-50 text-[var(--vscode-button-foreground)]">
            <div className="pl-3 pr-3 py-1.5 rounded-l text-sm flex items-center bg-[var(--vscode-button-background)]">
              <Play className="w-4 h-4 mr-1.5" /> Run
            </div>
            <div className="pl-2.5 pr-2 py-1.5 rounded-r text-xs font-medium flex items-center gap-1 border-l border-[var(--vscode-button-foreground)]/30 bg-[var(--vscode-button-background)]">
              {modeLabel}
              <ChevronDown className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="pl-3 pr-2 py-1.5 rounded text-sm flex items-center bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] opacity-50">
            <GitCompare className="w-4 h-4 mr-1.5" /> Run Changed
            <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-80" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="w-px h-5 mr-0.5 bg-[var(--vscode-widget-border)]" />
            <SkeletonSwitch label="+Deps" />
            <SkeletonSwitch label="+Dependents" />
            <SkeletonSwitch label="Full Refresh" />
          </div>
        </div>
      </div>

      {/* Query accordion */}
      <div className="rounded-xl border border-[var(--vscode-widget-border)]/50 overflow-hidden">
        <div className="flex items-center px-4 py-2.5">
          <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400 opacity-50" />
          <span className="font-semibold text-[var(--vscode-foreground)] text-sm mr-3 opacity-50">Query</span>
          <Bar className="h-3 w-48 max-w-[40%]" />
        </div>
        <div className="border-t border-[var(--vscode-widget-border)] p-4 space-y-2.5">
          {['w-1/4', 'w-2/3', 'w-1/2', 'w-3/5', 'w-1/3', 'w-2/5', 'w-1/2', 'w-1/4'].map((width, i) => (
            <div key={i} className="flex items-center gap-4">
              <Bar className="h-3 w-4 shrink-0" />
              <Bar className={`h-3 ${width}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
