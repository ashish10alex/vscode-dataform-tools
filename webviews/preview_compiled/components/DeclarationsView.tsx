import React, { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../../components/ui/data-table';
import { Declarations } from '../types';
import { vscode as vsCodeApi } from '../utils/vscode';

interface DeclarationsViewProps {
  declarations: Declarations[];
}

type DeclarationRow = {
  dataset: string;
  name: string;
  link: string;
};

export const DeclarationsView: React.FC<DeclarationsViewProps> = ({ declarations }) => {
  const data = useMemo<DeclarationRow[]>(() =>
    declarations.map(d => ({
      dataset: `${d.target.database}.${d.target.schema}`,
      name: d.target.name,
      link: `https://console.cloud.google.com/bigquery?project=${d.target.database}&ws=!1m5!1m4!4m3!1s${d.target.database}!2s${d.target.schema}!3s${d.target.name}`,
    })),
    [declarations]
  );

  const columns = useMemo<ColumnDef<DeclarationRow>[]>(() => [
    {
      accessorKey: 'dataset',
      header: 'Project.Dataset',
      size: 250,
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <button
          className="text-[var(--vscode-textLink-foreground)] hover:underline text-left"
          onClick={e => {
            e.stopPropagation();
            vsCodeApi.postMessage({ command: 'openExternal', url: row.original.link });
          }}
        >
          {row.original.dataset}.{row.original.name}
        </button>
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
          autoFocusColumnId="dataset"
          initialSorting={[{ id: 'dataset', desc: false }]}
        />
      </div>
    </div>
  );
};
