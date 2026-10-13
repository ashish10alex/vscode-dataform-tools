import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import clsx from "clsx";
import { vscode } from "../utils/vscode";
import { ROW_TOKEN, ROW_TOKEN_SET } from "./SummaryRow";

interface CompilerOverridesProps {
  initialCompilerOptions?: string;
  /**
   * Each override as a token of a line that wraps, in place of the form: one that is set shows its value, one that
   * is not is an outline to click and type in. For where the form's four empty fields would crowd what is beside them.
   */
  tokens?: boolean;
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
  tokens,
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

  /** The override being typed in, of the tokens */
  const [editing, setEditing] = useState<string | null>(null);

  if (tokens) {
    const fields = [
      { key: "prefix", label: "prefix", value: tablePrefix, set: setTablePrefix, placeholder: "AA", flag: "--table-prefix", help: "Table prefix: prefixes all table names (e.g. AA_table)" },
      { key: "schema", label: "schema suffix", value: schemaSuffix, set: setSchemaSuffix, placeholder: "dev", flag: "--schema-suffix", help: "Schema suffix: suffixes dataset names (e.g. dataset_dev)" },
      { key: "database", label: "database suffix", value: databaseSuffix, set: setDatabaseSuffix, placeholder: "dev", flag: "--database-suffix", help: "Database suffix: suffixes the project ID (e.g. project_dev)" },
      { key: "other", label: "option", value: otherOptions, set: setOtherOptions, placeholder: "--vars=key=value", flag: "", help: "Other options: additional CLI flags (e.g. --vars=key=value)" },
    ];
    return (
      <>
        {fields.map((field) => editing === field.key ? (
          <span key={field.key} className={clsx(ROW_TOKEN, "border-[var(--vscode-focusBorder)]")} title={field.help}>
            <span className="text-[var(--vscode-descriptionForeground)]">{field.label}</span>
            <input
              autoFocus
              type="text"
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              onBlur={() => setEditing(null)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { setEditing(null); } }}
              placeholder={field.placeholder}
              aria-label={field.help}
              size={Math.max(8, field.value.length + 1)}
              className="bg-transparent border-0 outline-none p-0 font-mono text-xs text-[var(--vscode-input-foreground,var(--vscode-foreground))] placeholder:text-[var(--vscode-input-placeholderForeground)]"
            />
          </span>
        ) : field.value ? (
          <span key={field.key} className={ROW_TOKEN} style={ROW_TOKEN_SET} title={`${field.help}\n${field.flag ? `${field.flag}="${field.value}"` : field.value}`}>
            <button type="button" onClick={() => setEditing(field.key)} className="flex items-center gap-1.5 bg-transparent border-0 p-0 text-inherit">
              <span className="opacity-75">{field.label}</span>
              <span className="font-mono">{field.value}</span>
            </button>
            <button type="button" onClick={() => field.set("")} aria-label={`Remove the ${field.label}`} title={`Remove the ${field.label}`} className="bg-transparent border-0 p-0 px-0.5 text-inherit opacity-60 hover:opacity-100">×</button>
          </span>
        ) : (
          <button key={field.key} type="button" onClick={() => setEditing(field.key)} title={field.help} className={clsx(ROW_TOKEN, "border-dashed text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]")}>
            + {field.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => vscode.postMessage({ command: 'openExternal', url: 'https://dataformtools.com/blog/compiler-options' })}
          title="What the compiler overrides do"
          className="ml-0.5 text-xs text-[var(--vscode-textLink-foreground)] hover:underline flex items-center bg-transparent border-0 p-0"
        >
          Docs <ExternalLink className="w-3 h-3 ml-1" />
        </button>
      </>
    );
  }

  return (
    <div className="pb-4 border-b border-[var(--vscode-widget-border)]/40">
      <div
        className="flex items-center py-2 cursor-pointer hover:opacity-80 transition-opacity justify-between"
        onClick={() => setIsCompilerOptionsOpen(!isCompilerOptionsOpen)}
      >
        <div className="flex items-center">
          {isCompilerOptionsOpen ? (
            <ChevronDown className="w-4 h-4 mr-2 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 mr-2 text-zinc-400" />
          )}
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">Compiler Overrides</span>
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

      {isCompilerOptionsOpen && (
        <div className="pt-3 space-y-3">
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
