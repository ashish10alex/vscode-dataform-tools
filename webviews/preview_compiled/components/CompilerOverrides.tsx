import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { vscode } from "../utils/vscode";

interface CompilerOverridesProps {
  initialCompilerOptions?: string;
  /** Inside a section that opens and closes itself: the fields are always shown, under a plain heading */
  embedded?: boolean;
}

/** The compiler options the four fields stand for, as one command-line string */
function generatedOptions(tablePrefix: string, schemaSuffix: string, databaseSuffix: string, otherOptions: string): string {
  const parts = [];
  if (tablePrefix) {
    parts.push(`--table-prefix="${tablePrefix}"`);
  }
  if (schemaSuffix) {
    parts.push(`--schema-suffix="${schemaSuffix}"`);
  }
  if (databaseSuffix) {
    parts.push(`--database-suffix="${databaseSuffix}"`);
  }
  if (otherOptions) {
    parts.push(otherOptions);
  }
  return parts.join(" ");
}

/** The four fields of a command-line string of compiler options */
function parseOptions(given: string): { tablePrefix: string; schemaSuffix: string; databaseSuffix: string; other: string[] } {
  const parts = given.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const parsed = { tablePrefix: "", schemaSuffix: "", databaseSuffix: "", other: [] as string[] };
  for (const part of parts) {
    if (part.startsWith("--table-prefix=")) {
      parsed.tablePrefix = part.split('=')[1].replace(/"/g, '');
    } else if (part.startsWith("--schema-suffix=")) {
      parsed.schemaSuffix = part.split('=')[1].replace(/"/g, '');
    } else if (part.startsWith("--database-suffix=")) {
      parsed.databaseSuffix = part.split('=')[1].replace(/"/g, '');
    } else {
      parsed.other.push(part);
    }
  }
  return parsed;
}

/** The overrides that are set, each in a few words, e.g. ["prefix AA", "schema suffix dev"]. Empty when none is */
export function overrideLabels(compilerOptions: string | undefined): string[] {
  const { tablePrefix, schemaSuffix, databaseSuffix, other } = parseOptions(compilerOptions ?? "");
  return [
    tablePrefix && `prefix ${tablePrefix}`,
    schemaSuffix && `schema suffix ${schemaSuffix}`,
    databaseSuffix && `database suffix ${databaseSuffix}`,
    other.length > 0 && other.join(" "),
  ].filter((label): label is string => !!label);
}

export const CompilerOverrides: React.FC<CompilerOverridesProps> = ({
  initialCompilerOptions,
  embedded,
}) => {
  const [compilerOptions, setCompilerOptions] = useState("");
  const [isCompilerOptionsOpen, setIsCompilerOptionsOpen] = useState(false);
  const [tablePrefix, setTablePrefix] = useState("");
  const [schemaSuffix, setSchemaSuffix] = useState("");
  const [databaseSuffix, setDatabaseSuffix] = useState("");
  const [otherOptions, setOtherOptions] = useState("");

  /** The options the host last gave, as the fields write them: what is not to be sent back as a change of the user's */
  const fromHost = useRef("");
  /** The options last sent to the host: when they come back, the fields already show them or something newer */
  const sent = useRef<string | null>(null);

  // The options are those of the Project of the file on show: when the host gives others, the fields follow
  useEffect(() => {
    const given = initialCompilerOptions ?? "";
    if (given === sent.current) {
      return;
    }
    const { tablePrefix: tp, schemaSuffix: ss, databaseSuffix: ds, other } = parseOptions(given);
    fromHost.current = generatedOptions(tp, ss, ds, other.join(" "));
    sent.current = null;
    setCompilerOptions(fromHost.current);
    if (given) {
      setIsCompilerOptionsOpen(true);
    }
    setTablePrefix(tp);
    setSchemaSuffix(ss);
    setDatabaseSuffix(ds);
    setOtherOptions(other.join(" "));
  }, [initialCompilerOptions]);

  useEffect(() => {
    const newOptions = generatedOptions(tablePrefix, schemaSuffix, databaseSuffix, otherOptions);
    if (newOptions !== compilerOptions) {
      setCompilerOptions(newOptions);
    }
  }, [tablePrefix, schemaSuffix, databaseSuffix, otherOptions]);

  // Only what the user changed is sent: options the host gave are another Project's to keep when sent back
  useEffect(() => {
    if (compilerOptions === fromHost.current) {
      return;
    }
    const timer = setTimeout(() => {
      fromHost.current = compilerOptions;
      sent.current = compilerOptions;
      vscode.postMessage({
        command: "dataform.updateCompilerOptions",
        compilerOptions,
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [compilerOptions]);

  return (
    <div className={embedded ? undefined : "pb-4 border-b border-[var(--vscode-widget-border)]/40"}>
      <div
        className={embedded ? "flex items-center justify-between" : "flex items-center py-2 cursor-pointer hover:opacity-80 transition-opacity justify-between"}
        onClick={embedded ? undefined : () => setIsCompilerOptionsOpen(!isCompilerOptionsOpen)}
      >
        <div className="flex items-center">
          {embedded ? null : isCompilerOptionsOpen ? (
            <ChevronDown className="w-4 h-4 mr-2 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 mr-2 text-zinc-400" />
          )}
          <span className={embedded ? "text-xs font-medium text-[var(--vscode-descriptionForeground)]" : "font-semibold text-zinc-700 dark:text-zinc-200"}>Compiler Overrides</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'openExternal', url: 'https://dataformtools.com/blog/compiler-options' });
          }}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center"
        >
          Docs <ExternalLink className="w-3 h-3 ml-1" />
        </button>
      </div>

      {(embedded || isCompilerOptionsOpen) && (
        <div className={embedded ? "pt-2 space-y-3" : "pt-3 space-y-3"}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
                Table Prefix
              </label>
              <input
                type="text"
                value={tablePrefix}
                onChange={(e) => setTablePrefix(e.target.value)}
                placeholder='e.g. AA'
                className="w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-1.5 text-sm text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] transition-colors placeholder:text-[var(--vscode-input-placeholderForeground)]"
              />
              <p className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">Prefixes all table names (e.g. <code>AA_table</code>)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
                Schema Suffix
              </label>
              <input
                type="text"
                value={schemaSuffix}
                onChange={(e) => setSchemaSuffix(e.target.value)}
                placeholder='e.g. dev'
                className="w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-1.5 text-sm text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] transition-colors placeholder:text-[var(--vscode-input-placeholderForeground)]"
              />
              <p className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">Suffixes dataset names (e.g. <code>dataset_dev</code>)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
                Database Suffix
              </label>
              <input
                type="text"
                value={databaseSuffix}
                onChange={(e) => setDatabaseSuffix(e.target.value)}
                placeholder='e.g. dev'
                className="w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-1.5 text-sm text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] transition-colors placeholder:text-[var(--vscode-input-placeholderForeground)]"
              />
              <p className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">Suffixes project ID (e.g. <code>project_dev</code>)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--vscode-descriptionForeground)] mb-1">
                Other Options
              </label>
              <input
                type="text"
                value={otherOptions}
                onChange={(e) => setOtherOptions(e.target.value)}
                placeholder='e.g. --vars=key=value'
                className="w-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded px-3 py-1.5 text-sm text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] transition-colors placeholder:text-[var(--vscode-input-placeholderForeground)]"
              />
              <p className="mt-1 text-[10px] text-[var(--vscode-descriptionForeground)] opacity-70">Additional CLI flags</p>
            </div>
          </div>

          {compilerOptions && (
            <div className="mt-2 pt-2 border-t border-[var(--vscode-widget-border)]">
              <span className="text-[10px] font-mono text-[var(--vscode-descriptionForeground)] opacity-70 select-all">
                Generated: {compilerOptions}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
