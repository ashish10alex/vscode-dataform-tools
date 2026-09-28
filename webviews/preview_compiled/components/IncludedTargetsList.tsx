import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { WorkflowUrlEntry } from '../types';
import { describeActionTypes } from '../../../src/shared/actionTypes';

type Target = NonNullable<WorkflowUrlEntry['includedTargets']>[number];

function TargetName({ target }: { target: Target }) {
    return (
        <span className="break-all" title={`${target.database}.${target.schema}.${target.name}`}>
            {target.schema}.{target.name}
        </span>
    );
}

/** A single target is shown as is; more are collapsed behind a count by action type that expands in place. */
export function IncludedTargetsList({ targets, typeCounts }: { targets: Target[]; typeCounts: WorkflowUrlEntry['includedTargetTypes'] }) {
    const [expanded, setExpanded] = useState(false);
    if (targets.length === 1) {
        return <TargetName target={targets[0]} />;
    }
    return (
        <div className="flex flex-col gap-0.5">
            <button
                onClick={() => setExpanded(v => !v)}
                className="self-start inline-flex items-center gap-1 rounded text-left hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                aria-expanded={expanded}
                title={expanded ? 'Hide actions' : 'Show actions'}
            >
                {expanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                {describeActionTypes(targets.length, typeCounts)}
            </button>
            {expanded && (
                <div className="flex flex-col gap-0.5 pl-[1.125rem]">
                    {targets.map((target, i) => <TargetName key={i} target={target} />)}
                </div>
            )}
        </div>
    );
}
