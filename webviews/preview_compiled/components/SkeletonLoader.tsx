import React from 'react';
import clsx from 'clsx';
import { Cloud, Eye, Loader2, Network, Play, Settings, ShieldCheck, Wand2 } from 'lucide-react';
import { ROW_BUTTON, SummaryRow } from './SummaryRow';
import { RUN_GROUP, RUN_MAIN_PART, RunRow } from './RunParts';
import { TargetRow } from './TargetRow';

interface SkeletonLoaderProps {
  type?: 'default' | 'config';
  mode?: 'cli' | 'api';
  /** The version of @dataform/core the compile installs first, which takes a while */
  installing?: string;
}

// Placeholder bar standing in for text that has not arrived yet.
const Bar: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded bg-[var(--vscode-foreground)] opacity-10 ${className}`} />
);

/** A bar in a line of text. The pulse is of what holds it: it would take the place of the bar's own opacity */
const PulsingBar: React.FC<{ className?: string }> = ({ className }) => (
  <span aria-hidden="true" className="animate-pulse inline-block align-middle"><Bar className={className} /></span>
);

/** A button of a row, as it is while a compile runs: there, and not to be clicked */
const RowButton: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span aria-hidden="true" className={clsx(ROW_BUTTON, 'opacity-50')}>{children}</span>
);

/** A run modifier, off */
const Chip: React.FC<{ label: string }> = ({ label }) => (
  <span aria-hidden="true" className="inline-flex items-center gap-1 h-6 px-1.5 rounded border border-[var(--vscode-widget-border)] text-xs whitespace-nowrap flex-shrink-0 text-[var(--vscode-descriptionForeground)] opacity-50">
    <span className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-foreground)] opacity-25" />
    {label}
  </span>
);

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({ type = 'default', mode = 'cli', installing }) => {
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

  // The rows of the compiled query, each in its place: the Compile row says what is going on, the others wait for it
  const compilingWith = `ompiling with the ${mode === 'api' ? 'Dataform API' : 'CLI'}…`;
  return (
    <div className="pb-20">
      <div className="-mx-4 -mt-4">
        <TargetRow>
          <div className="animate-pulse space-y-1.5" aria-hidden="true">
            <div className="flex items-center gap-1.5 h-[22px]">
              <Bar className="h-4 w-12" />
              <Bar className="h-3.5 w-64 max-w-[60%]" />
            </div>
            <Bar className="h-3 w-44 max-w-[40%]" />
          </div>
        </TargetRow>

        <SummaryRow
          label="Compile"
          tone="busy"
          summary={<>
            <Loader2 className="inline w-3.5 h-3.5 mr-1.5 align-middle animate-spin text-[var(--vscode-textLink-foreground)]" />
            <span className="align-middle">{installing ? `Installing @dataform/core@${installing} and c${compilingWith}` : `C${compilingWith}`}</span>
          </>}
          actions={<>
            <RowButton><Wand2 className="w-3 h-3" /> Format</RowButton>
            <RowButton><ShieldCheck className="w-3 h-3" /> Lint</RowButton>
          </>}
          // Open as the row will be once compiled, with the line of its settings waiting, so that nothing moves then
          defaultOpen
        >
          <div aria-hidden="true" className="animate-pulse flex flex-wrap items-center gap-1.5">
            <Bar className="h-6 w-24" />
            <Bar className="h-6 w-28" />
            <Bar className="h-6 w-20" />
          </div>
        </SummaryRow>

        <SummaryRow
          label="Lineage"
          summary={<PulsingBar className="h-3 w-40" />}
          actions={<>
            <RowButton><Network className="w-3 h-3" /> Graph</RowButton>
            <RowButton><Eye className="w-3 h-3" /> Preview Data</RowButton>
          </>}
        />

        <RunRow>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Chip label="+Deps" />
            <Chip label="+Dependents" />
            <Chip label="Full refresh" />
          </div>
          <div aria-hidden="true" className={clsx(RUN_GROUP, 'ml-auto opacity-50')}>
            <span className={RUN_MAIN_PART}>
              {mode === 'api' ? <Cloud className="w-3 h-3" /> : <Play className="w-3 h-3" />} File
            </span>
          </div>
        </RunRow>

        <SummaryRow label="Last run" summary={<PulsingBar className="h-3 w-56" />} />
      </div>

      {/* The SQL: its tabs, and the lines of the query */}
      <div aria-hidden="true">
        <div className="-mx-4 px-2 h-9 border-b border-[var(--vscode-widget-border)]">
          <div className="animate-pulse flex items-center gap-3 h-full">
            <Bar className="h-6 w-14" />
            <Bar className="h-3 w-48 max-w-[40%]" />
          </div>
        </div>
        <div className="animate-pulse pt-3 space-y-2.5">
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
