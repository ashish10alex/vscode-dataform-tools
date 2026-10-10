import { Check, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';
import { WorkflowUrlEntry } from '../types';
import { formatDuration } from '../../../src/shared/jobTiming';
import { RunStages, RunVia, runStageLines, timeToStart } from '../../../src/shared/runStages';

const MUTED = 'text-[var(--vscode-descriptionForeground)]';

/** `0:53`, `12:07`, `1:02:07` */
export function clock(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const pad = (value: number) => String(value).padStart(2, '0');
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
}

export function runVia(entry: WorkflowUrlEntry): RunVia {
    return entry.executionMode === 'cli' ? 'cli' : 'api';
}

/**
 * The stages of a run on its way to its first job, as a checklist: those done with how long each took, the one it is
 * in, and those to come. `ended` is a run that ended before any job. `lookingFor` says where its jobs are looked for.
 */
export function RunStageChecklist({ stages, via, ended = false, lookingFor }: { stages: RunStages; via: RunVia; ended?: boolean; lookingFor?: string }) {
    const lines = runStageLines(stages, via, Date.now(), ended);
    return (
        <div className="flex flex-col">
            {lines.map((line) => (
                <div key={line.label} className={clsx('flex items-center gap-2 px-1.5 py-1', line.state === 'todo' && 'opacity-50')}>
                    <span className="w-3.5 flex-shrink-0 flex justify-center">
                        {line.state === 'done' && <Check className="w-3 h-3 text-[var(--vscode-extensionIcon-preReleaseForeground)]" />}
                        {line.state === 'current' && <RefreshCw className="w-3 h-3 animate-spin text-[var(--vscode-textLink-foreground)]" />}
                        {line.state === 'failed' && <X className="w-3 h-3 text-[var(--vscode-errorForeground)]" />}
                        {line.state === 'todo' && <span className={MUTED}>·</span>}
                    </span>
                    <span className={line.state === 'failed' ? 'text-[var(--vscode-errorForeground)]' : undefined}>{line.label}</span>
                    {line.ms !== undefined && (
                        <span className={clsx('ml-auto font-mono text-[10px] tabular-nums', MUTED)}>
                            {line.state === 'current' ? clock(line.ms) : formatDuration(line.ms)}
                        </span>
                    )}
                </div>
            ))}
            {lookingFor && !ended && (
                <div className={clsx('pl-7 pr-1.5 pb-1 font-mono text-[10px] break-all', MUTED)} title="Where the run's BigQuery jobs are looked for">{lookingFor}</div>
            )}
        </div>
    );
}

/** Where a CLI run's jobs are looked for: the start of their IDs, and the project */
export function jobsLookedFor(entry: WorkflowUrlEntry): string | undefined {
    return entry.jobPrefix ? `${entry.jobPrefix}… in ${entry.projectId ?? 'an unknown project'}` : undefined;
}

/** One line on how long a run took to get to its first job, or to be submitted, and where the time went. Nothing for a run that has not, or that kept no stages */
export function RunStartSummary({ entry, className }: { entry: WorkflowUrlEntry; className?: string }) {
    const via = runVia(entry);
    const total = entry.stages ? timeToStart(entry.stages, via) : undefined;
    if (!entry.stages || total === undefined) {
        return null;
    }
    const parts = runStageLines(entry.stages, via, Date.now()).filter((line) => line.ms !== undefined).map((line) => `${line.short} ${formatDuration(line.ms!)}`);
    return (
        <div className={clsx('text-[10px]', MUTED, className)} title="From the moment the run was invoked">
            {via === 'cli' ? 'First job' : 'Submitted'} after {clock(total)} · {parts.join(' · ')}
        </div>
    );
}
