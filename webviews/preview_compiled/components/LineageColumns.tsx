import { ExternalLink, FileCode, Loader2 } from "lucide-react";
import { getUrlToNavigateToTableInBigQuery, parseBigQueryTableId } from "../../utils/bigquery";

interface Table {
  id: string;
  /** `project.dataset`, which tables are grouped under */
  dataset: string;
  name: string;
  /** Null for an ID that is no `project.dataset.table`, which has no page in BigQuery */
  url: string | null;
}

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

/** The tables of a list once each, in the order given, under the dataset they are in */
function byDataset(given: unknown[]): [string, Table[]][] {
  const groups = new Map<string, Table[]>();
  const seen = new Set<string>();
  for (const table of given.map(tableOf)) {
    if (!seen.has(table.id)) {
      seen.add(table.id);
      groups.set(table.dataset, [...(groups.get(table.dataset) ?? []), table]);
    }
  }
  return [...groups.entries()];
}

const TAG = "flex-shrink-0 px-1 rounded border text-[9.5px] font-mono uppercase tracking-wider leading-4";
const ICON_BUTTON = "grid place-items-center w-5 h-5 rounded bg-transparent border-0 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]";

interface ColumnProps {
  heading: string;
  tables: unknown[];
  /** The IDs of what the file on show builds: they are marked, not listed as if they were another file's */
  own: Set<string>;
  /** The IDs that are of no action of the Project: there is no definition to go to */
  external?: Set<string>;
  /** What is said where the list is empty */
  none: string;
  /** At the end of the heading's line */
  aside?: React.ReactNode;
  onOpen: (id: string) => void;
}

function Column({ heading, tables, own, external, none, aside, onOpen }: ColumnProps) {
  const groups = byDataset(tables);
  const count = groups.reduce((sum, [, group]) => sum + group.length, 0);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-xs font-medium text-[var(--vscode-foreground)]">{heading}</span>
        <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">{count}</span>
        {aside && <span className="ml-auto text-[11px] text-[var(--vscode-descriptionForeground)]">{aside}</span>}
      </div>
      {count === 0 && <span className="text-xs italic text-[var(--vscode-descriptionForeground)]">{none}</span>}
      {groups.map(([dataset, group]) => (
        <div key={dataset} className="mb-1.5">
          {dataset && <div title={dataset} className="truncate font-mono text-[10.5px] text-[var(--vscode-descriptionForeground)]">{dataset}</div>}
          {group.map((table) => {
            const isExternal = !!external?.has(table.id);
            return (
              <div key={table.id} title={table.id} className="group flex items-center gap-1.5 h-[22px] min-w-0 -mx-1 px-1 rounded hover:bg-[var(--vscode-list-hoverBackground)]">
                <span className="truncate font-mono text-xs text-[var(--vscode-foreground)]">{table.name}</span>
                {own.has(table.id) && <span className={`${TAG} text-[var(--vscode-textLink-foreground)] border-[var(--vscode-textLink-foreground)]`} title="Built by the file on show">this file</span>}
                {isExternal && <span className={`${TAG} text-[var(--vscode-descriptionForeground)] border-[var(--vscode-widget-border)]`} title="Not built by this Project: Dataplex knows of it">external</span>}
                <span className="ml-auto flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  {!isExternal && (
                    <button type="button" onClick={() => onOpen(table.id)} title="Go to definition" aria-label={`Go to the definition of ${table.name}`} className={ICON_BUTTON}>
                      <FileCode className="w-3 h-3" />
                    </button>
                  )}
                  {table.url && (
                    <a href={table.url} target="_blank" rel="noopener noreferrer" title="Open in BigQuery" aria-label={`Open ${table.name} in BigQuery`} className={ICON_BUTTON}>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
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
 * What the file reads and what reads it, side by side where the panel is wide enough. Tables are under their
 * dataset, so a line is a table's name and no longer its whole ID. What Dataplex knows of is among what reads the
 * file, with the tables this Project does not build marked.
 */
export function LineageColumns({ reads, readBy, own, dataplex, loadingDataplex, onLoadDataplex, onOpen }: LineageColumnsProps) {
  const ownIds = new Set(own.map((target) => tableOf(target).id));
  const localIds = new Set(readBy.map((target) => tableOf(target).id));
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
      {loadingDataplex && <Loader2 className="w-3 h-3 animate-spin" />} + Dataplex
    </button>
  ) : dataplex.error ? (
    <span className="text-[var(--vscode-errorForeground)]" title={dataplex.error.message || "Unknown error"}>Dataplex: {dataplex.error.message || "unknown error"}</span>
  ) : (
    <span title="What Dataplex says reads this table is in the list">with Dataplex · {external.size === 0 ? "none external" : `${external.size} external`}</span>
  );

  return (
    <div className="grid grid-cols-1 min-[520px]:grid-cols-2 gap-x-5 gap-y-3">
      <Column heading="Reads from" tables={reads} own={ownIds} none="Nothing" onOpen={onOpen} />
      <Column heading="Read by" tables={[...readBy, ...external]} own={ownIds} external={external} none="Nothing in this Project" aside={aside} onOpen={onOpen} />
    </div>
  );
}
