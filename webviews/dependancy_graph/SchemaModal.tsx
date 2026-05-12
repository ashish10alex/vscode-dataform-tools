import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../components/ui/data-table';

export interface SchemaField {
    name: string;
    type: string;
    mode?: string;
    description?: string;
    fields?: SchemaField[];
}

export type SchemaModalState =
    | { status: 'loading'; fullTableName: string; projectId: string; datasetId: string; tableId: string }
    | {
          status: 'loaded';
          fullTableName: string;
          projectId: string;
          datasetId: string;
          tableId: string;
          fields: SchemaField[];
          /** BigQuery returns lastModifiedTime as epoch ms in a string. */
          lastModifiedTime?: string;
      }
    | { status: 'error'; fullTableName: string; projectId: string; datasetId: string; tableId: string; error: string };

/** Render the BigQuery lastModifiedTime (epoch ms string) as a human date. */
function formatLastModified(raw: string | undefined): string | null {
    if (!raw) {return null;}
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {return null;}
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) {return null;}
    // Use the browser/host locale; include date + time, drop seconds.
    return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

interface FlatRow {
    name: string;
    type: string;
    description: string;
    depth: number;
}

function flatten(fields: SchemaField[], depth = 0, out: FlatRow[] = []): FlatRow[] {
    for (const f of fields) {
        out.push({ name: f.name, type: f.type, description: f.description ?? '', depth });
        if (f.fields && f.fields.length > 0) {
            flatten(f.fields, depth + 1, out);
        }
    }
    return out;
}

interface Props {
    state: SchemaModalState;
    onClose: () => void;
}

const SchemaModal: React.FC<Props> = ({ state, onClose }) => {
    const rows = useMemo<FlatRow[]>(
        () => (state.status === 'loaded' ? flatten(state.fields) : []),
        [state]
    );

    const columns = useMemo<ColumnDef<FlatRow>[]>(
        () => [
            {
                accessorKey: 'name',
                header: 'Name',
                size: 220,
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <span
                            style={{ paddingLeft: r.depth * 16 }}
                            className="font-mono text-xs whitespace-nowrap"
                        >
                            {r.depth > 0 ? '↳ ' : ''}
                            {r.name}
                        </span>
                    );
                },
            },
            {
                accessorKey: 'type',
                header: 'Type',
                size: 140,
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-[var(--vscode-disabledForeground)]">
                        {row.original.type}
                    </span>
                ),
            },
            {
                accessorKey: 'description',
                header: 'Description',
                size: 280,
                cell: ({ row }) => (
                    <span className="text-xs text-[var(--vscode-disabledForeground)]">
                        {row.original.description}
                    </span>
                ),
            },
        ],
        []
    );

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="schema-modal-title"
                className="w-[720px] max-w-[90vw] h-[70vh] max-h-[80vh] flex flex-col rounded-md shadow-xl border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBarSectionHeader-background)]">
                    <div className="min-w-0 flex-1">
                        <div className="text-xs uppercase tracking-wider text-[var(--vscode-disabledForeground)]">
                            Schema
                        </div>
                        <div
                            id="schema-modal-title"
                            className="text-sm font-semibold text-[var(--vscode-foreground)] font-mono break-all"
                        >
                            {state.fullTableName}
                        </div>
                        {state.status === 'loaded' && formatLastModified(state.lastModifiedTime) && (
                            <div className="mt-1 text-[11px] text-[var(--vscode-disabledForeground)]">
                                Last updated: {formatLastModified(state.lastModifiedTime)}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="shrink-0 p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)]"
                        title="Close (Esc)"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden p-3">
                    {state.status === 'loading' && (
                        <div className="px-1 py-4 text-sm text-[var(--vscode-foreground)]">
                            Fetching schema from BigQuery…
                        </div>
                    )}

                    {state.status === 'error' && (
                        <div className="px-1 py-2 text-sm">
                            <div className="font-semibold text-[var(--vscode-errorForeground)] mb-1">
                                Failed to fetch schema
                            </div>
                            <div className="text-[var(--vscode-foreground)] whitespace-pre-wrap break-words">
                                {state.error}
                            </div>
                            <div className="mt-3 text-xs text-[var(--vscode-disabledForeground)]">
                                Make sure you're authenticated:{' '}
                                <code className="font-mono">gcloud auth application-default login</code>
                            </div>
                        </div>
                    )}

                    {state.status === 'loaded' && rows.length === 0 && (
                        <div className="px-1 py-4 text-sm text-[var(--vscode-disabledForeground)]">
                            BigQuery returned no schema for this table.
                        </div>
                    )}

                    {state.status === 'loaded' && rows.length > 0 && (
                        <DataTable
                            columns={columns}
                            data={rows}
                            autoFocusColumnId="name"
                            paginated={false}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default SchemaModal;
