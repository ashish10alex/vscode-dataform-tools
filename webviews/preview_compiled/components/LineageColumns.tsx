import { ReactNode, useState } from "react";
import clsx from "clsx";
import { ExternalLink, Loader2 } from "lucide-react";
import { getUrlToNavigateToTableInBigQuery, parseBigQueryTableId } from "../../utils/bigquery";
import { rememberTab, tabLeftOn } from "../utils/rowLayout";

/** A line of a list: a table, or an action that builds none */
export interface LineageEntry {
  id: string;
  /** `project.dataset`, shown in front of the name. Empty for what is in no dataset */
  dataset: string;
  name: string;
  /** Null for what has no page in BigQuery */
  url: string | null;
  /** Words that say what it is, e.g. its kind */
  tags?: { text: string; title?: string }[];
  /** Goes to its definition. Unset where there is none to go to */
  open?: () => void;
}

type Table = LineageEntry;

/** A table of the lists, from its Target or its ID. One that is neither is listed as it was given */
function tableOf(given: unknown): Table {
  const parsed = parseBigQueryTableId(given);
  if (!parsed) {
    return { id: String(given), dataset: "", name: String(given), url: null };
  }
  return {
    id: `${parsed.database}.${parsed.schema}.${parsed.name}`,
    dataset: `${parsed.database}.${parsed.schema}`,
    name: parsed.name,
    url: getUrlToNavigateToTableInBigQuery(parsed.database, parsed.schema, parsed.name),
  };
}

/** The tables of a list once each, in the order given */
function once(given: Table[]): Table[] {
  const seen = new Set<string>();
  return given.filter((table) => !seen.has(table.id) && !!seen.add(table.id));
}

const TAG = "flex-shrink-0 px-1 rounded border text-[10px] font-mono uppercase tracking-wider leading-4";
const ICON_BUTTON = "grid place-items-center w-5 h-5 rounded bg-transparent border-0 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]";
const MUTED = "text-[var(--vscode-descriptionForeground)]";

/** One of the lists: what the file reads, what reads it, what tests it */
interface LineageList {
  key: string;
  /** The name on its tab */
  label: string;
  tables: Table[];
  /** The IDs of what the file on show builds: they are marked, not listed as if they were another file's */
  own?: Set<string>;
  /** The IDs that are of no action of the Project: there is no definition to go to */
  external?: Set<string>;
  /** What is said where the list is empty */
  none: string;
  /** Under the list */
  footer?: ReactNode;
}

/** The group the chosen tab is kept under, for every file */
const TAB_GROUP = "Lineage";

/**
 * The lists, one on show at a time under a tab for each: a line is as wide as the panel, so a name is rarely cut
 * short. A table is one line, as `project.dataset.table` with the table's name the brightest. The tab the user chose
 * is on show for the next file too, and on the next page.
 */
function Lists({ lists }: { lists: LineageList[] }) {
  const [chosen, setChosen] = useState<string | null>(() => tabLeftOn(TAB_GROUP) ?? null);
  const shown = lists.find((list) => list.key === chosen) ?? lists[0];
  if (!shown) {
    return null;
  }
  const tables = once(shown.tables);
  return (
    // From edge to edge of the row, whose padding is 0.75rem
    <div className="-mx-3 border-t border-[var(--vscode-widget-border)]">
      <div role="tablist" aria-label="Lineage" className="flex border-b border-[var(--vscode-widget-border)]">
        {lists.map((list) => (
          <button
            key={list.key}
            type="button"
            role="tab"
            aria-selected={list === shown}
            onClick={() => {
              setChosen(list.key);
              rememberTab(TAB_GROUP, list.key);
            }}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 h-7 -mb-px px-2 bg-transparent border-0 border-b-2 border-solid text-xs whitespace-nowrap cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]",
              list === shown ? "border-[var(--vscode-focusBorder)] text-[var(--vscode-foreground)]" : clsx("border-transparent hover:text-[var(--vscode-foreground)]", MUTED)
            )}
          >
            {list.label} <span className={MUTED}>{once(list.tables).length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" data-lineage={shown.key}>
        {tables.length === 0 && shown.none && <p className={clsx("m-0 px-3 py-1.5 text-xs italic", MUTED)}>{shown.none}</p>}
        {tables.map((table) => {
          const own = !!shown.own?.has(table.id);
          const isExternal = !!shown.external?.has(table.id);
          // `project.dataset.` in front of the name, dimmer, so the name is what the eye finds
          const name = <>{table.dataset && <span className={MUTED}>{table.dataset}.</span>}{table.name}</>;
          return (
            <div key={table.id} title={table.id} className="group flex items-center gap-1.5 min-h-[26px] px-3 border-b border-[color-mix(in_srgb,var(--vscode-widget-border)_45%,transparent)] hover:bg-[var(--vscode-list-hoverBackground)]">
              <span className="flex-1 min-w-0 flex items-center gap-1.5">
                {table.open ? (
                  <button
                    type="button"
                    onClick={table.open}
                    title={`${table.id}\nGo to definition`}
                    className={clsx("min-w-0 truncate p-0 bg-transparent border-0 font-mono text-xs text-left cursor-pointer hover:text-[var(--vscode-textLink-foreground)] hover:underline", own ? MUTED : "text-[var(--vscode-foreground)]")}
                  >
                    {name}
                  </button>
                ) : <span className={clsx("min-w-0 truncate font-mono text-xs", own ? MUTED : "text-[var(--vscode-foreground)]")}>{name}</span>}
                {table.tags?.map((tag) => <span key={tag.text} className={clsx(TAG, MUTED, "border-[var(--vscode-widget-border)]")} title={tag.title}>{tag.text}</span>)}
                {/* A word, not a badge: it is the least of what the list has to say */}
                {own && <span className={clsx("flex-shrink-0 text-xs whitespace-nowrap", MUTED)} title="Built by the file on show">this file</span>}
                {isExternal && <span className={clsx(TAG, MUTED, "border-[var(--vscode-widget-border)]")} title="Not built by this Project: Dataplex knows of it">external</span>}
              </span>
              {table.url && (
                <a href={table.url} target="_blank" rel="noopener noreferrer" title="Open in BigQuery" aria-label={`Open ${table.name} in BigQuery`} className={clsx(ICON_BUTTON, "flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100")}>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          );
        })}
        {shown.footer && <div className={clsx("px-3 pt-1.5 text-xs", MUTED)}>{shown.footer}</div>}
      </div>
    </div>
  );
}

interface LineageColumnsProps {
  /** What the file's actions read, as Targets */
  reads: unknown[];
  /** What reads the file's first action in the Project, as Targets or IDs */
  readBy: unknown[];
  /** The Targets of the file's own actions */
  own: unknown[];
  /** What Dataplex says reads the file's first table, once asked for */
  dataplex?: { dependencies?: string[]; error?: { message?: string } } | null;
  loadingDataplex: boolean;
  onLoadDataplex: () => void;
  /** Open the definition of the action that builds the table of this ID */
  onOpen: (id: string) => void;
}

/**
 * What the file reads and what reads it. What Dataplex knows of is among what reads the file, with the tables this
 * Project does not build marked.
 */
export function LineageColumns({ reads, readBy, own, dataplex, loadingDataplex, onLoadDataplex, onOpen }: LineageColumnsProps) {
  const ownIds = new Set(own.map((target) => tableOf(target).id));
  const local = readBy.map(tableOf);
  const localIds = new Set(local.map((table) => table.id));
  // What only Dataplex knows of is of no action of the Project: there is no definition to go to
  const entry = (table: Table): Table => ({ ...table, open: () => onOpen(table.id) });
  const fromDataplex = dataplex && !dataplex.error ? dataplex.dependencies ?? [] : [];
  const external = new Set(fromDataplex.filter((id) => !localIds.has(id)));

  const aside = !dataplex ? (
    <button
      type="button"
      onClick={onLoadDataplex}
      disabled={loadingDataplex}
      title="Ask Dataplex what else reads this table, outside this Project"
      className="inline-flex items-center gap-1 bg-transparent border-0 p-0 text-[var(--vscode-textLink-foreground)] hover:underline disabled:opacity-60 disabled:no-underline"
    >
      {loadingDataplex && <Loader2 className="w-3 h-3 animate-spin" />} + Dataplex: what else reads this table
    </button>
  ) : dataplex.error ? (
    <span className="text-[var(--vscode-errorForeground)]" title={dataplex.error.message || "Unknown error"}>Dataplex: {dataplex.error.message || "unknown error"}</span>
  ) : (
    <span title="What Dataplex says reads this table is in the list">with Dataplex · {external.size === 0 ? "none external" : `${external.size} external`}</span>
  );

  return (
    <Lists
      lists={[
        { key: "dependencies", label: "← Reads from", tables: reads.map(tableOf).map(entry), own: ownIds, none: "Nothing" },
        { key: "dependents", label: "Read by →", tables: [...local.map(entry), ...[...external].map(tableOf)], own: ownIds, external, none: "Nothing in this Project", footer: aside },
      ]}
    />
  );
}

interface LineageListsProps {
  reads: LineageEntry[];
  readBy: LineageEntry[];
  /** What tests the file's actions. No list where there is none */
  tests: LineageEntry[];
  /** What is said where nothing reads the file's actions. No list where it is unset: nothing can read them */
  noneReadBy?: string;
}

/**
 * The same lists for entries that are made elsewhere, with the tests of the file's actions under them: for a Project
 * whose actions are not all tables, and that Dataplex is not asked about.
 */
export function LineageLists({ reads, readBy, tests, noneReadBy }: LineageListsProps) {
  return (
    <Lists
      lists={[
        { key: "dependencies", label: "← Reads from", tables: reads, none: "Nothing" },
        ...(readBy.length > 0 || noneReadBy ? [{ key: "dependents", label: "Read by →", tables: readBy, none: noneReadBy ?? "" }] : []),
        ...(tests.length > 0 ? [{ key: "tests", label: "Tests", tables: tests, none: "" }] : []),
      ]}
    />
  );
}
