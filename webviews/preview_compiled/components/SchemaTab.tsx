import React, { useMemo, useState } from 'react';
import { WebviewState } from '../types';
import { DataTable } from '../../components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';
import { Download, Edit2, Copy, Check } from 'lucide-react';
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
  const [isCopied, setIsCopied] = useState(false);

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
              className="w-full px-2 py-1 text-xs bg-transparent border border-transparent rounded hover:border-[var(--vscode-input-border)] focus:border-[var(--vscode-focusBorder)] focus:bg-[var(--vscode-input-background)] focus:outline-none transition-colors"
              value={value || ''}
              onChange={(e) => {
                setEditedDescriptions(prev => ({
                  ...prev,
                  [row.original.name]: e.target.value
                }));
              }}
              placeholder="Add description..."
            />
            <Edit2 className="absolute right-2 w-3 h-3 text-[var(--vscode-descriptionForeground)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </div>
        );
      }
    },
  ], []);

  const formatAsUnquotedJson = (dataObj: Record<string, string>) => {
    const lines = Object.entries(dataObj).map(([key, value]) => {
      return `  ${key}: ${JSON.stringify(value)}`;
    });
    return `{\n${lines.join(',\n')}\n}`;
  };

  const handleCopyJson = () => {
    const exportData = data.reduce((acc, field) => {
      acc[field.name] = field.description || '';
      return acc;
    }, {} as Record<string, string>);

    vscode.postMessage({
      command: 'copyToClipboard',
      value: formatAsUnquotedJson(exportData)
    });
    
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 400);
  };

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
      value: formatAsUnquotedJson(exportData),
      filename: filename
    });
  };

  if (!state.compiledQuerySchema || state.compiledQuerySchema.fields.length === 0) {
    return (
        <div className="p-8 text-center text-[var(--vscode-descriptionForeground)]">
            <p>No schema available.</p>
        </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-end gap-2 p-2 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)]">
        <button
          onClick={handleCopyJson}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--vscode-button-secondaryForeground)] bg-[var(--vscode-button-secondaryBackground)] border border-[var(--vscode-widget-border)] rounded-md hover:bg-[var(--vscode-button-secondaryHoverBackground)] transition-colors shadow-sm w-28 justify-center"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[var(--vscode-extensionIcon-preReleaseForeground)]" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copy JSON
            </>
          )}
        </button>
        <button
          onClick={handleExportJson}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--vscode-button-secondaryForeground)] bg-[var(--vscode-button-secondaryBackground)] border border-[var(--vscode-widget-border)] rounded-md hover:bg-[var(--vscode-button-secondaryHoverBackground)] transition-colors shadow-sm w-28 justify-center"
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
