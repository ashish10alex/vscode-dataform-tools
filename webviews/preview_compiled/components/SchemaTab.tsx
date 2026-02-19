import React, { useMemo } from 'react';
import { WebviewState } from '../types';
import { DataTable } from './ui/data-table';
import { ColumnDef } from '@tanstack/react-table';

interface SchemaTabProps {
  state: WebviewState;
}

type SchemaField = {
    name: string;
    type: string;
    description?: string;
    mode?: string;
};

export const SchemaTab: React.FC<SchemaTabProps> = ({ state }) => {

  const data = useMemo(() => state.compiledQuerySchema?.fields || [], [state.compiledQuerySchema]);

  const columns = useMemo<ColumnDef<SchemaField>[]>(() => [
    {
      accessorKey: "name",
      header: "Name",
      size: 150,
    },
    {
      accessorKey: "type",
      header: "Type",
      size: 100,
    },
    {
      accessorKey: "description",
      header: "Description",

      size: 400,
    },
  ], []);

  if (!state.compiledQuerySchema || state.compiledQuerySchema.fields.length === 0) {
    return (
        <div className="p-8 text-center text-zinc-400 dark:text-zinc-500">
            <p>No schema available.</p>
        </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <DataTable columns={columns} data={data} searchPlaceholder="Filter schema..." autoFocusColumnId="name" />
      </div>
    </div>
  );
};
