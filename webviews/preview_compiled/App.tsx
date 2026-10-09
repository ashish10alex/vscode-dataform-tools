import { useState, useEffect, useRef, useCallback } from 'react';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { Loader2, Info, Settings, Terminal, Cloud } from 'lucide-react';
import { vscode } from './utils/vscode';
import { CompiledQueryTab } from './components/CompiledQueryTab';
import { SchemaTab } from './components/SchemaTab';
import { CostEstimatorTab } from './components/CostEstimatorTab';
import { WorkflowURLsTab } from './components/WorkflowURLsTab';
import {
  TERMINAL_WORKFLOW_STATES,
  POLL_FAST_MS,
  POLL_CANCELING_MS,
  POLL_SLOW_MS,
  POLL_FAST_DURATION_MS,
  POLL_TIMEOUT_MS,
} from './utils/workflowPolling';

import { DeclarationsView } from './components/DeclarationsView';
import { ProjectConfigTab } from './components/ProjectConfigTab';
import { CompilationError } from './components/CompilationError';
import { CompilationErrorType } from './types';
import { SkeletonLoader } from './components/SkeletonLoader';
import { panelProblem } from './utils/panelProblem';
import { fileView } from './utils/fileView';
import { PanelSlices, fileOnShow } from '../../src/shared/panelState';
import { DbtPanel } from './components/DbtPanel';
import { ProjectInfoTab, useProjectInfoRequest } from './components/ProjectInfoTab';
import { PanelHeader, HeaderTab, HeaderMenu } from './components/PanelHeader';

/** The panel of a Dataform Project, and of a file in no Project */
function DataformPanel({ state }: { state: PanelSlices }) {
  const problem = panelProblem(state);
  const view = fileView(state.file);
  const fileName = fileOnShow(state);
  const [activeTab, setActiveTab] = useState<'compilation' | 'schema' | 'cost' | 'workflow_urls' | 'project_config' | 'project'>('compilation');
  useProjectInfoRequest(useCallback(() => setActiveTab('project'), []));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!state.dataform.snoozeEndTime || state.dataform.snoozeEndTime <= Date.now()) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (state.dataform.snoozeEndTime && current >= state.dataform.snoozeEndTime) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [state.dataform.snoozeEndTime]);

  const isSnoozed = !!(state.dataform.snoozeEndTime && state.dataform.snoozeEndTime > now);
  const remainingSec = isSnoozed ? Math.max(0, Math.ceil((state.dataform.snoozeEndTime! - now) / 1000)) : 0;
  const minutesLeft = Math.floor(remainingSec / 60);
  const secondsLeft = remainingSec % 60;
  const timeLeftFormatted = `${minutesLeft}:${secondsLeft.toString().padStart(2, "0")}`;

  const handleStartSnooze = () => {
    vscode.postMessage({ command: "dataform.startSnooze" });
  };

  const handleStopSnooze = () => {
    vscode.postMessage({ command: "dataform.stopSnooze" });
  };
  const [isPolling, setIsPolling] = useState(false);
  const pollStartedAtRef = useRef<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A CLI run is followed by the host, by its BigQuery jobs: the Dataform API knows nothing of it
    const items = (state.dataform.workflowUrls || []).filter(i => i.executionMode !== 'cli');
    const hasNonTerminal = items.some(i => !i.state || !TERMINAL_WORKFLOW_STATES.has(i.state));
    const hasFailedMissingActions = items.some(i =>
      i.state === 'FAILED' && (!i.failedActions || i.failedActions.length === 0)
    );
    const shouldPoll = hasNonTerminal || hasFailedMissingActions;

    if (!shouldPoll) {
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      pollStartedAtRef.current = null;
      setIsPolling(false);
      return;
    }

    const justStarted = pollStartedAtRef.current === null;
    if (justStarted) { pollStartedAtRef.current = Date.now(); }
    setIsPolling(true);

    const elapsed = Date.now() - pollStartedAtRef.current!;
    if (elapsed >= POLL_TIMEOUT_MS) {
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      setIsPolling(false);
      return;
    }

    if (justStarted) {
      vscode.postMessage({ command: 'dataform.refreshWorkflowStatuses' });
      return;
    }

    const isCanceling = items.some(i => i.state === 'CANCELING');
    const delay = isCanceling ? POLL_CANCELING_MS : elapsed < POLL_FAST_DURATION_MS ? POLL_FAST_MS : POLL_SLOW_MS;
    pollTimerRef.current = setTimeout(() => {
      vscode.postMessage({ command: 'dataform.refreshWorkflowStatuses' });
    }, delay);

    return () => {
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [state.dataform.workflowUrls]);

  const isConfigFile = fileName === 'workflow_settings.yaml' || fileName === 'dataform.json' || fileName === 'package.json';

  // While a compile runs no error is on show, so only what the file has to show keeps the skeleton away
  const showSkeleton = problem.compiling && !view.tableOrViewQuery && !view.testQuery && !view.expectedOutputQuery && !state.dataform.projectConfig && !state.dataform.packageJson && !view.declarations;

  // Property graphs have no output schema, no bytes-scanned estimate and no compiled query,
  // so the panel collapses to a single tab for them.
  const isPropertyGraphFile = (state.dataform.propertyGraphs?.length ?? 0) > 0;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      // Ignore if modifier keys are pressed
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
        return;
      }

      if (e.key === 's') {
        e.preventDefault();
        setActiveTab('schema');
      } else if (e.key === 'c') {
        e.preventDefault();
        setActiveTab('compilation');
      } else if (e.key === 'w') {
        e.preventDefault();
        setActiveTab('workflow_urls');
      } else if (e.key === 'p') {
        e.preventDefault();
        setActiveTab('project');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    // The Project tab is of the Project, not of the file: it stays whichever file is shown
    if (activeTab === 'project') {
      return;
    }
    if (fileName === 'workflow_settings.yaml' || fileName === 'dataform.json' || fileName === 'package.json') {
      setActiveTab('project_config');
    } else if (activeTab === 'project_config' || (isPropertyGraphFile && activeTab !== 'compilation')) {
      setActiveTab('compilation');
    }
  }, [fileName, activeTab, isPropertyGraphFile]);

  // Handle declarations view (full page override)
  if (view.declarations && activeTab !== 'project') {
    return <DeclarationsView declarations={view.declarations} />;
  }


  return (
    <div className="flex flex-col h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] overflow-hidden">
      <PanelHeader
        className="bg-[var(--vscode-sideBar-background)]"
        tabs={isConfigFile ? (
          <>
            <HeaderTab active={activeTab !== 'project'} onClick={() => setActiveTab('project_config')}>
              <Settings className="w-4 h-4 mr-1.5" />
              Project Configuration
            </HeaderTab>
            <HeaderTab active={activeTab === 'project'} onClick={() => setActiveTab('project')} title="Project (P)">Project</HeaderTab>
          </>
        ) : (
          <>
            <HeaderTab active={activeTab === 'compilation'} onClick={() => setActiveTab('compilation')} title="Compiled Query (C)">Query</HeaderTab>
            {!isPropertyGraphFile && (
              <>
                <HeaderTab active={activeTab === 'schema'} onClick={() => setActiveTab('schema')} title="Schema (S)">Schema</HeaderTab>
                <HeaderTab active={activeTab === 'cost'} onClick={() => setActiveTab('cost')} title="Cost Estimator">Cost</HeaderTab>
                <HeaderTab active={activeTab === 'workflow_urls'} onClick={() => setActiveTab('workflow_urls')} title="Workflow Executions (W)">Executions</HeaderTab>
              </>
            )}
            <HeaderTab active={activeTab === 'project'} onClick={() => setActiveTab('project')} title="Project (P)">Project</HeaderTab>
          </>
        )}
        actions={
          <HeaderMenu
            snoozeTimeLeft={isSnoozed ? timeLeftFormatted : undefined}
            onStartSnooze={handleStartSnooze}
            onStopSnooze={handleStopSnooze}
            shortcuts={[
              ...(isConfigFile ? [] : [{ label: 'Compiled Query', hint: 'C', onSelect: () => setActiveTab('compilation') }]),
              ...(isConfigFile || isPropertyGraphFile ? [] : [
                { label: 'Schema', hint: 'S', onSelect: () => setActiveTab('schema') },
                { label: 'Workflow Executions', hint: 'W', onSelect: () => setActiveTab('workflow_urls') },
              ]),
              { label: 'Project', hint: 'P', onSelect: () => setActiveTab('project') },
            ]}
          />
        }
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'project' && <ProjectInfoTab state={state} />}
        {activeTab !== 'project' && (<>
        {problem.compiling && (() => {
          const mode = state.dataform.compilationMode || state.dataform.compilationInfo?.mode || 'cli';
          const isApi = mode === 'api';
          const modeLabel = isApi ? 'API' : 'CLI';
          return (
            <div className="mb-4">
              <div className="flex items-center gap-2 text-[var(--vscode-textLink-foreground)]">
                <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                <span>
                  {state.dataform.dataformCoreVersion
                    ? `Installing @dataform/core@${state.dataform.dataformCoreVersion} and compiling${state.project?.label ? ` ${state.project.label}` : ''}...`
                    : `Compiling Dataform${state.project?.label ? ` project ${state.project.label}` : ''}...`}
                </span>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border border-[var(--vscode-widget-border)]"
                  title={isApi ? "Compiling remotely with the Dataform API" : "Compiling locally with the Dataform CLI"}
                >
                  {isApi ? <Cloud className="w-3.5 h-3.5" /> : <Terminal className="w-3.5 h-3.5" />}
                  {modeLabel}
                </span>
              </div>
              {state.dataform.dataformCoreVersion && (
                <div className="mt-4 border-l-4 border-[var(--vscode-inputValidation-warningBorder)] pl-4 py-3 mr-4 bg-[var(--vscode-inputValidation-warningBackground)] rounded-r-md shadow-sm">
                  <h4 className="flex items-center gap-2 m-0 text-sm font-semibold text-[var(--vscode-inputValidation-warningForeground)] mb-2">
                    <Info className="w-4 h-4" />
                    Note
                  </h4>
                  <div className="text-[13px] text-[var(--vscode-foreground)] opacity-90 leading-relaxed pr-2">
                    <p className="m-0">
                      When specifying <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">dataformCoreVersion</code> in <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">workflow_settings.yaml</code>, Dataform CLI copies over the project to a temporary directory, adds <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">package.json</code>, and installs dataform core by running <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">npm install</code>. This requires a network call and might take time. To avoid this, create a local <code className="bg-[var(--vscode-editor-background)] px-1.5 py-0.5 rounded font-mono text-[12px] border border-[var(--vscode-widget-border)]">package.json</code>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {showSkeleton && (
            <SkeletonLoader type={isConfigFile ? 'config' : 'default'} mode={state.dataform.compilationMode || state.dataform.compilationInfo?.mode} />
        )}

{(problem.type === CompilationErrorType.COMPILATION_ERROR ||
          (!isPropertyGraphFile && (
            !view.models?.length ||
            problem.missingTools.length > 0
          ))) && (
          <CompilationError state={state} />
        )}

        {isConfigFile && !showSkeleton && <ProjectConfigTab state={state} />}
        {!isConfigFile && (view.isHelperFile || (!view.tableOrViewQuery && !view.operationsQuery && !view.assertionQuery && !view.incrementalQuery && !view.testQuery && !view.expectedOutputQuery && !view.declarations && !view.models?.some((m: any) => m.type === 'notebook') && fileName?.endsWith('.js'))) && (
            <div>
                <code className="text-sm font-mono bg-[var(--vscode-editor-background)] px-2 py-1 rounded border border-[var(--vscode-widget-border)] text-[var(--vscode-textPreformat-foreground)]">
                    {fileName}
                </code>
            </div>
        )}

        {!isConfigFile && !view.isHelperFile && activeTab === 'compilation' && (
          isPropertyGraphFile ||
          view.tableOrViewQuery ||
          view.operationsQuery ||
          view.assertionQuery ||
          view.incrementalQuery ||
          view.testQuery ||
          view.expectedOutputQuery ||
          view.declarations ||
          view.models?.some((m: any) => m.type === 'notebook')
        ) && <CompiledQueryTab state={state} />}
        {!isConfigFile && !view.isHelperFile && !isPropertyGraphFile && activeTab === 'schema' && <SchemaTab state={state} />}
        {!isConfigFile && !view.isHelperFile && !isPropertyGraphFile && activeTab === 'cost' && <CostEstimatorTab state={state} />}
        {!isConfigFile && !view.isHelperFile && !isPropertyGraphFile && activeTab === 'workflow_urls' && <WorkflowURLsTab state={state} isPolling={isPolling} />}
        </>)}

      </div>
    </div>
  );
}

/** One panel for both Backends: the Project's Backend says which is drawn */
function App() {
  const state = useVSCodeMessage();

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isDark = document.body.classList.contains('vscode-dark');
          if (isDark) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }
      });
    });

    observer.observe(document.body, { attributes: true });
    
    // Initial check
    if (document.body.classList.contains('vscode-dark')) {
      document.documentElement.classList.add('dark');
    }

    return () => observer.disconnect();
  }, []);

  return state.project?.backend === 'dbt' ? <DbtPanel state={state} /> : <DataformPanel state={state} />;
}

export default App;
