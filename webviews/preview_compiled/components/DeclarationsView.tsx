import React, { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Eye } from 'lucide-react';
import { DataTable } from '../../components/ui/data-table';
import { Declarations } from '../types';
import { vscode as vsCodeApi } from '../utils/vscode';
import { ROW_BUTTON } from './SummaryRow';

interface DeclarationsViewProps {
  /** Only where each table is matters here */
  declarations: Array<Pick<Declarations, 'target'>>;
}

type DeclarationRow = {
  target: Declarations['target'];
  source: string;
  project: string;
  dataset: string;
  name: string;
  link: string;
};

export const DeclarationsView: React.FC<DeclarationsViewProps> = ({ declarations }) => {
  const data = useMemo<DeclarationRow[]>(() =>
    declarations.map(d => ({
      target: d.target,
      source: `${d.target.database}.${d.target.schema}.${d.target.name}`,
      project: d.target.database,
      dataset: d.target.schema,
      name: d.target.name,
      link: `https://console.cloud.google.com/bigquery?project=${d.target.database}&ws=!1m5!1m4!4m3!1s${d.target.database}!2s${d.target.schema}!3s${d.target.name}`,
    })),
    [declarations]
  );

  const columns = useMemo<ColumnDef<DeclarationRow>[]>(() => [
    {
      accessorKey: 'source',
      header: 'Source',
      // Order by dataset first, then table name, then project.
      sortingFn: (a, b) =>
        a.original.dataset.localeCompare(b.original.dataset) ||
        a.original.name.localeCompare(b.original.name) ||
        a.original.project.localeCompare(b.original.project),
      // One cell for both, so that a long name wraps beside its button and never under the next column
      cell: ({ row }) => (
        <div className="flex items-start gap-3">
          <button
            className={`${ROW_BUTTON} shrink-0`}
            title="Show the first rows. A table is read without a query, which costs nothing; a view is queried."
            onClick={e => {
              e.stopPropagation();
              vsCodeApi.postMessage({ command: 'dataform.previewDeclaration', target: row.original.target });
            }}
          >
            <Eye className="w-3 h-3" /> Preview
          </button>
          <button
            className="min-w-0 break-all leading-6 text-[var(--vscode-textLink-foreground)] hover:underline text-left"
            title="Open in the BigQuery console"
            onClick={e => {
              e.stopPropagation();
              vsCodeApi.postMessage({ command: 'openExternal', url: row.original.link });
            }}
          >
            {row.original.source}
          </button>
        </div>
      ),
    },
  ], []);

  if (declarations.length === 0) {
    return <div className="p-4 text-[var(--vscode-disabledForeground)]">No declarations found for this file.</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <DataTable
          columns={columns}
          data={data}
          autoFocusColumnId="source"
          initialSorting={[{ id: 'source', desc: false }]}
        />
      </div>
    </div>
  );
};
