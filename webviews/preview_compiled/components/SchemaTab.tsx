import React, { useMemo, useState } from 'react';
import { WebviewState } from '../types';
import { DataTable } from '../../components/ui/data-table';
import { ColumnDef, ExpandedState } from '@tanstack/react-table';
import { Download, Edit2, Copy, Check, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { vscode } from '../utils/vscode';
import type { ColumnMetadata } from '../../../src/types';
import { buildColumnsConfig, formatAsUnquotedJson, pathKey } from '../../../src/utils/schemaTree';

interface SchemaTabProps {
  state: WebviewState;
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

const buttonClassName = "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--vscode-button-secondaryForeground)] bg-[var(--vscode-button-secondaryBackground)] border border-[var(--vscode-widget-border)] rounded-md hover:bg-[var(--vscode-button-secondaryHoverBackground)] transition-colors shadow-sm justify-center";

export const SchemaTab: React.FC<SchemaTabProps> = ({ state }) => {
  const [editedDescriptions, setEditedDescriptions] = useState<Record<string, string>>({});
  const [isCopied, setIsCopied] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const fields = state.compiledQuerySchema?.fields || [];

  const data = useMemo(
    () => buildRows(fields, editedDescriptions),
    [state.compiledQuerySchema, editedDescriptions]
  );

  const hasNestedFields = useMemo(() => fields.some((field) => field.fields?.length), [state.compiledQuerySchema]);

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
      value: columnsConfigText()
    });
    
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 400);
  };

  const handleExportJson = () => {
    let filename = 'schema.json';
    const target = state.targetTablesOrViews?.[0]?.target || state.models?.[0]?.target;
    if (target) {
      filename = `${target.database}_${target.schema}_${target.name}.json`;
    }

    vscode.postMessage({
      command: 'exportSchema',
      value: columnsConfigText(),
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
        {hasNestedFields && (
          <>
            <button onClick={() => setExpanded(true)} className={buttonClassName}>
              <ChevronsUpDown className="w-3.5 h-3.5" />
              Expand all
            </button>
            <button onClick={() => setExpanded({})} className={buttonClassName}>
              <ChevronsDownUp className="w-3.5 h-3.5" />
              Collapse all
            </button>
          </>
        )}
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
