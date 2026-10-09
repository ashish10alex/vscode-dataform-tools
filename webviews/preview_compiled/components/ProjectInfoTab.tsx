import React, { useEffect } from "react";
import clsx from "clsx";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { HostEvent, InfoLink, InfoRow, InfoSection } from "../../../src/shared/panelContract";
import type { PanelSlices } from "../../../src/shared/panelState";
import { vscode } from "../utils/vscode";

const MUTED = "text-[var(--vscode-descriptionForeground)]";
const WARNING = "text-[var(--vscode-editorWarning-foreground,#cca700)]";
const LINK = "p-0 bg-transparent border-0 cursor-pointer text-left font-mono text-xs text-[var(--vscode-textLink-foreground)] hover:underline break-all";

/** Calls `show` when the host asks for the Project tab, as the "Show Project Info" command does */
export function useProjectInfoRequest(show: () => void) {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if ((event.data as HostEvent | undefined)?.event === "show project info") {
        show();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [show]);
}

const LINK_TITLE: Record<InfoLink["kind"], string> = {
  setting: "Open the settings file at this setting",
  path: "Open it, or show where it is",
  url: "Open in the browser",
  "sign in": "Put this command in a terminal, for you to run",
};

function Linked({ link, muted, children }: { link?: InfoLink; muted?: boolean; children: React.ReactNode }) {
  if (!link) {
    return <span className={clsx("break-all", muted && MUTED)}>{children}</span>;
  }
  return (
    <button className={clsx(LINK, muted && "opacity-80")} title={LINK_TITLE[link.kind]} onClick={() => vscode.postMessage({ command: "followInfoLink", link })}>
      {children}
    </button>
  );
}

function Row({ row }: { row: InfoRow }) {
  return (
    <>
      <dt className={clsx("text-xs self-baseline", MUTED)}>{row.label}</dt>
      <dd className="m-0 font-mono text-xs self-baseline min-w-0">
        <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <Linked link={row.link} muted={row.absent}>{row.value}</Linked>
          {row.note && <Linked link={row.noteLink} muted>{row.note}</Linked>}
        </span>
        {row.warning && (
          <span data-info="warning" className={clsx("flex items-start gap-1 mt-0.5 font-sans", WARNING)}>
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>{row.warning}</span>
          </span>
        )}
      </dd>
    </>
  );
}

function Section({ section }: { section: InfoSection }) {
  return (
    <section data-info={section.name}>
      <h3 className="m-0 mb-2 text-sm font-semibold flex items-center gap-2">
        {section.title}
        {section.note && <span className={clsx("text-xs font-normal", MUTED)}>{section.note}</span>}
        {section.looking && <Loader2 className={clsx("w-3 h-3 animate-spin", MUTED)} />}
      </h3>
      <dl className="m-0 grid grid-cols-[minmax(130px,max-content)_1fr] gap-x-4 gap-y-1.5">
        {section.rows.map((row, index) => (
          <Row key={index} row={row} />
        ))}
      </dl>
    </section>
  );
}

/**
 * The Project tab of both Backends' panels: which tools, settings, Google account and git branch are in use, and
 * where each came from. The host looks them up while the tab is on show, so the tab says when it is and is not.
 */
export function ProjectInfoTab({ state }: { state: PanelSlices }) {
  useEffect(() => {
    vscode.postMessage({ command: "projectInfoShown" });
    return () => vscode.postMessage({ command: "projectInfoHidden" });
  }, []);

  // What was looked up for another Project than the one on show is not this one's
  const info = state.projectInfo && (!state.project || state.project.root === state.projectInfo.root) ? state.projectInfo : undefined;
  const looking = !info || info.sections.some((section) => section.looking);
  const warnings = info?.sections.flatMap((section) => section.rows).filter((row) => row.warning).length ?? 0;

  return (
    <div data-tab="project info" className="space-y-6 select-text">
      <div className="flex items-center gap-3">
        {warnings > 0 && (
          <span className={clsx("flex items-center gap-1 text-xs", WARNING)}>
            <AlertTriangle className="w-3.5 h-3.5" />
            {warnings === 1 ? "1 thing to look at" : `${warnings} things to look at`}
          </span>
        )}
        <button
          className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-widget-border)] disabled:opacity-50"
          title="Look everything up again: the Google accounts and the tools' versions too"
          disabled={!info}
          onClick={() => vscode.postMessage({ command: "refreshProjectInfo" })}
        >
          <RefreshCw className={clsx("w-3 h-3", looking && "animate-spin")} />
          Refresh
        </button>
      </div>
      {info ? info.sections.map((section) => <Section key={section.name} section={section} />) : <div className={clsx("text-sm", MUTED)}>Looking the Project up…</div>}
    </div>
  );
}
