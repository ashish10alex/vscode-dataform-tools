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
    },
    {
      accessorKey: "type",
      header: "Type",
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ getValue, row }) => {
          const initialValue = getValue() as string || "";
          const [value, setValue] = React.useState(initialValue);
          
          const onBlur = () => {
              console.log(`Updated description for ${row.original.name}: ${value}`);
          };

          // If the initialValue changes (e.g. data refresh), update local state
          React.useEffect(() => {
              setValue(initialValue);
          }, [initialValue]);

          return (
              <input
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  onBlur={onBlur}
                  className="w-full bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded px-1 -mx-1"
                  placeholder="Add description..."
              />
          );
      },
      size: 300, // wider column
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
       <div className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          <i>Edit description to update documentation.</i>
       </div>
      <div className="flex-1 overflow-hidden">
        <DataTable columns={columns} data={data} searchPlaceholder="Filter schema..." />
      </div>
    </div>
  );
};
