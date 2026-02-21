import React, { useMemo, useState } from 'react';
import { WebviewState } from '../types';
import { DataTable } from './ui/data-table';
import { ColumnDef } from '@tanstack/react-table';
import { Download, Edit2 } from 'lucide-react';
import { vscode } from '../utils/vscode';

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
  const [editedDescriptions, setEditedDescriptions] = useState<Record<string, string>>({});

  const data = useMemo(() => {
    return (state.compiledQuerySchema?.fields || []).map(field => ({
      ...field,
      description: editedDescriptions[field.name] !== undefined 
        ? editedDescriptions[field.name] 
        : field.description
    }));
  }, [state.compiledQuerySchema, editedDescriptions]);

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
      cell: ({ row, getValue }) => {
        const value = getValue() as string;
        return (
          <div className="relative group flex items-center">
            <input
              type="text"
              className="w-full px-2 py-1 text-xs bg-transparent border border-transparent rounded hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-blue-500 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none transition-colors"
              value={value || ''}
              onChange={(e) => {
                setEditedDescriptions(prev => ({
                  ...prev,
                  [row.original.name]: e.target.value
                }));
              }}
              placeholder="Add description..."
            />
            <Edit2 className="absolute right-2 w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </div>
        );
      }
    },
  ], []);

  const handleExportJson = () => {
    const exportData = data.reduce((acc, field) => {
      acc[field.name] = field.description || '';
      return acc;
    }, {} as Record<string, string>);

    let filename = 'schema.json';
    const target = state.targetTablesOrViews?.[0]?.target || state.models?.[0]?.target;
    if (target) {
      filename = `${target.database}_${target.schema}_${target.name}.json`;
    }

    vscode.postMessage({
      command: 'exportSchema',
      value: exportData,
      filename: filename
    });
  };

  if (!state.compiledQuerySchema || state.compiledQuerySchema.fields.length === 0) {
    return (
        <div className="p-8 text-center text-zinc-400 dark:text-zinc-500">
            <p>No schema available.</p>
        </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-end p-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
        <button
          onClick={handleExportJson}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors shadow-sm"
        >
          <Download className="w-3.5 h-3.5" />
          Export JSON
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <DataTable columns={columns} data={data} searchPlaceholder="Filter schema..." autoFocusColumnId="name" />
      </div>
    </div>
  );
};
