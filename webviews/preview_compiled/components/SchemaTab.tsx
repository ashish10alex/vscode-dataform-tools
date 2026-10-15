import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { PanelState } from '../types';
import { DataTable } from '../../components/ui/data-table';
import { ColumnDef, ExpandedState } from '@tanstack/react-table';
import { Download, Edit2, Copy, Check, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Loader2 } from 'lucide-react';
import { vscode } from '../utils/vscode';
import type { ColumnMetadata } from '../../../src/types';
import type { Target } from '../../../src/shared/compiledGraph';
import { buildColumnsConfig, formatAsUnquotedJson, pathKey } from '../../../src/utils/schemaTree';
import { schemaOnShow } from '../utils/bigQueryView';
import { ROW_BUTTON, RowChip } from './SummaryRow';
import { BigQueryTableLink } from '../../components/BigQueryTableLink';
import { parseBigQueryTableId } from '../../utils/bigquery';
import { TAB_STRIP, TabButton } from './SqlTabs';

interface SchemaTabProps {
  state: PanelState;
}

interface SchemaTableProps {
  /** The columns to show, as BigQuery gives a schema: nested ones under their parent */
  fields: ColumnMetadata[];
  /** The name of the file "Export JSON" offers */
  exportName: string;
}

type SchemaRow = {
    name: string;
    type: string;
    mode: string;
    description?: string;
    /** Unique key built from the field's full path (see `pathKey`). */
    path: string;
    depth: number;
    children?: SchemaRow[];
};

const buildRows = (
  fields: ColumnMetadata[],
  editedDescriptions: Record<string, string>,
  parentPath: string[] = []
): SchemaRow[] =>
  fields.map((field) => {
    const pathParts = [...parentPath, field.name];
    const path = pathKey(pathParts);
    return {
      name: field.name,
      type: field.type,
      // BigQuery omits mode for NULLABLE fields
      mode: field.mode || 'NULLABLE',
      description: editedDescriptions[path] !== undefined ? editedDescriptions[path] : field.description,
      path,
      depth: parentPath.length,
      children: field.fields?.length ? buildRows(field.fields, editedDescriptions, pathParts) : undefined,
    };
  });

/** A table on the Schema tab, of either Backend */
export interface SchemaTarget {
  /** The action's ID, by which the tab chosen is kept from one compile of the file to the next */
  id: string;
  target: Target;
  /** What the Backend calls it where that is not the table's name, e.g. a dbt model's */
  name?: string;
  /** Its columns. Null when there are none to show: placeholder rows take their place while they load */
  fields: ColumnMetadata[] | null;
  /** Its columns are to come, or to be replaced */
  loading: boolean;
  /** Its dry run failed: its tab has a dot */
  failed: boolean;
  /** A line under its name: where its columns come from, or why there are none */
  note?: { text: string; error?: boolean };
}

interface TargetSchemasProps {
  /** The file on show, which names the tab while its tables are not known */
  file?: string;
  targets: SchemaTarget[];
  /** A compile or dry runs are out. With no tables, they are not known yet */
  loading: boolean;
  /** What is said of a file with no tables, once nothing is loading */
  none: string;
}

/**
 * The Schema tab of either Backend: a tab for each table the file builds (none when it builds one), the name of the
 * table on show, and its columns. While a compile or its dry run is out the tab says so, so that the columns of
 * another table or file are never taken for the ones coming. The tab chosen stays while the same file is shown.
 */
export function TargetSchemas({ file, targets, loading, none }: TargetSchemasProps) {
  const [chosen, setChosen] = useState<{ file?: string; id: string } | null>(null);
  const shown = (chosen?.file === file && targets.find((target) => target.id === chosen?.id)) || targets[0];
  const busy = shown ? shown.loading : loading;
  return (
    <div className="h-full flex flex-col">
      {targets.length > 1 && (
        <div role="tablist" aria-label="Tables" className={TAB_STRIP}>
          {targets.map((target) => (
            <TabButton key={target.id} selected={target === shown} onClick={() => setChosen({ file, id: target.id })} failed={target.failed} title={target.failed ? `${tableId(target.target)}: its dry run failed` : tableId(target.target)}>
              {target.name ?? target.target.name}
            </TabButton>
          ))}
        </div>
      )}
      <div data-schema="target" className={clsx("pb-2 flex flex-wrap items-center gap-x-3 gap-y-1 min-h-[26px]", targets.length > 1 && "pt-3")}>
        {shown ? <TableName target={shown.target} /> : file && <span className="font-mono text-sm break-all text-[var(--vscode-descriptionForeground)]">{file}</span>}
        {shown?.name && <span className="font-mono text-sm text-[var(--vscode-descriptionForeground)]">{shown.name}</span>}
        {busy && (
          <span data-schema="loading">
            <RowChip tone="busy"><Loader2 className="w-2.5 h-2.5 animate-spin" /> {shown?.fields ? 'updating…' : 'loading schema…'}</RowChip>
          </span>
        )}
      </div>
      {shown?.note && (
        <p data-schema="note" className={clsx("m-0 pb-2 text-xs", shown.note.error ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>{shown.note.text}</p>
      )}
      {!shown && !loading && <p data-schema="note" className="m-0 pb-2 text-xs text-[var(--vscode-descriptionForeground)]">{none}</p>}
      <div className="flex-1 min-h-0">
        {shown?.fields ? (
          <SchemaTable key={shown.id} fields={shown.fields} exportName={`${[shown.target.database, shown.target.schema, shown.target.name].filter(Boolean).join('_')}.json`} />
        ) : busy ? (
          <SchemaSkeleton />
        ) : null}
      </div>
    </div>
  );
}

const tableId = (target: Target) => [target.database, target.schema, target.name].filter(Boolean).join('.');

/** The table's full name, which opens it in BigQuery when it has one there */
function TableName({ target }: { target: Target }) {
  return parseBigQueryTableId(target)
    ? <BigQueryTableLink id={target} className="font-mono text-sm break-all text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]" />
    : <span className="font-mono text-sm break-all">{tableId(target)}</span>;
}

/** The Schema tab of a Dataform file: its tables, views and incremental tables, with the columns their last dry runs gave */
export const SchemaTab: React.FC<SchemaTabProps> = ({ state }) => {
  const { file, targets, loading } = schemaOnShow(state);
  const shown = targets.map((target): SchemaTarget => ({
    id: target.id,
    target: target.target,
    fields: target.columns?.fields ?? null,
    loading: target.loading,
    failed: !!target.error,
    note: target.loading && !target.columns ? undefined
      : target.error ? { text: 'The dry run failed, so there is no schema. See the Query tab.', error: true }
      : !target.columns ? { text: 'No dry run gave columns for this table, so there is no schema.' }
      : undefined,
  }));
  return <TargetSchemas file={file} targets={shown} loading={loading} none="This file builds no table, so there is no schema." />;
};

/** Bars where the rows of a table of columns will be */
export const SchemaSkeleton: React.FC = () => (
  <div aria-hidden="true" className="animate-pulse border border-[var(--vscode-widget-border)] rounded-md overflow-hidden">
    <div className="flex gap-4 px-3 py-2 bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)]">
      {['w-12', 'w-10', 'w-20'].map((width, i) => <div key={i} className="flex-1"><div className={`h-3 ${width} rounded bg-[var(--vscode-foreground)] opacity-10`} /></div>)}
    </div>
    {['w-24', 'w-32', 'w-20', 'w-28', 'w-16'].map((width, row) => (
      <div key={row} className="flex gap-4 px-3 py-2.5 border-b last:border-b-0 border-[var(--vscode-widget-border)]">
        <div className="flex-1"><div className={`h-3 ${width} rounded bg-[var(--vscode-foreground)] opacity-10`} /></div>
        <div className="flex-1"><div className="h-3 w-14 rounded bg-[var(--vscode-foreground)] opacity-10" /></div>
        <div className="flex-1"><div className="h-3 w-3/4 rounded bg-[var(--vscode-foreground)] opacity-10" /></div>
      </div>
    ))}
  </div>
);

/**
 * A table of columns with their types and descriptions, for either Backend: a filter on each column, nested columns
 * that open, descriptions that can be edited, and the columns as JSON to copy or save.
 */
export const SchemaTable: React.FC<SchemaTableProps> = ({ fields, exportName }) => {
  const [editedDescriptions, setEditedDescriptions] = useState<Record<string, string>>({});
  const [isCopied, setIsCopied] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const data = useMemo(
    () => buildRows(fields, editedDescriptions),
    [fields, editedDescriptions]
  );

  const hasNestedFields = useMemo(() => fields.some((field) => field.fields?.length), [fields]);

  const columns = useMemo<ColumnDef<SchemaRow>[]>(() => [
    {
      accessorKey: "name",
      header: "Name",
      size: 200,
      cell: ({ row }) => (
        <div className="flex items-center" style={{ paddingLeft: row.depth * 16 }}>
          {row.getCanExpand() ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                row.toggleExpanded();
              }}
              className="mr-1 p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
              aria-label={row.getIsExpanded() ? `Collapse ${row.original.name}` : `Expand ${row.original.name}`}
            >
              {row.getIsExpanded() ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            hasNestedFields && <span className="mr-1 w-[18px] shrink-0" />
          )}
          <span className="break-all">{row.original.name}</span>
        </div>
      ),
    },
    {
      id: "type",
      // Include non-default modes so filtering by e.g. "REPEATED" works
      accessorFn: (row) => (row.mode === 'NULLABLE' ? row.type : `${row.type} ${row.mode}`),
      header: "Type",
      size: 140,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <span>{row.original.type}</span>
          {row.original.mode !== 'NULLABLE' && (
            <span
              className={`px-1 rounded text-[10px] leading-4 border ${
                row.original.mode === 'REPEATED'
                  ? 'font-semibold border-[var(--vscode-charts-yellow)] text-[var(--vscode-charts-yellow)]'
                  : 'border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
              }`}
            >
              {row.original.mode}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      size: 400,
      cell: ({ row, getValue }) => {
        const value = getValue() as string;
        return (
          <div className="relative group flex items-center">
            <input
              type="text"
              className="w-full px-2 py-1 text-xs bg-transparent border border-transparent rounded hover:border-[var(--vscode-input-border)] focus:border-[var(--vscode-focusBorder)] focus:bg-[var(--vscode-input-background)] focus:outline-none transition-colors"
              value={value || ''}
              onChange={(e) => {
                setEditedDescriptions(prev => ({
                  ...prev,
                  [row.original.path]: e.target.value
                }));
              }}
              placeholder="Add description..."
            />
            <Edit2 className="absolute right-2 w-3 h-3 text-[var(--vscode-descriptionForeground)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </div>
        );
      }
    },
  ], [hasNestedFields]);

  const columnsConfigText = () => formatAsUnquotedJson(buildColumnsConfig(fields, editedDescriptions));

  const handleCopyJson = () => {
    vscode.postMessage({
      command: 'copyToClipboard',
      text: columnsConfigText()
    });
    
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 400);
  };

  const handleExportJson = () => {
    vscode.postMessage({
      command: 'exportSchema',
      content: columnsConfigText(),
      fileName: exportName
    });
  };

  if (fields.length === 0) {
    return (
        <div className="p-8 text-center text-[var(--vscode-descriptionForeground)]">
            <p>No schema available.</p>
        </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap justify-end gap-1.5 px-2 py-1.5 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)]">
        {hasNestedFields && (
          <>
            <button onClick={() => setExpanded(true)} className={ROW_BUTTON}>
              <ChevronsUpDown className="w-3 h-3" />
              Expand all
            </button>
            <button onClick={() => setExpanded({})} className={ROW_BUTTON}>
              <ChevronsDownUp className="w-3 h-3" />
              Collapse all
            </button>
          </>
        )}
        <button
          onClick={handleCopyJson}
          className={ROW_BUTTON}
        >
          {isCopied ? (
            <>
              <Check className="w-3 h-3 text-[var(--vscode-extensionIcon-preReleaseForeground)]" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy JSON
            </>
          )}
        </button>
        <button
          onClick={handleExportJson}
          className={ROW_BUTTON}
        >
          <Download className="w-3 h-3" />
          Export JSON
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder="Filter schema..."
          autoFocusColumnId="name"
          getSubRows={(row) => row.children}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      </div>
    </div>
  );
};
