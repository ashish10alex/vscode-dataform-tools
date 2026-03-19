import { useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getExpandedRowModel,
  useReactTable,
  SortingState,
  ColumnFiltersState,
} from '@tanstack/react-table';
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchPlaceholder?: string
  autoFocusColumnId?: string
  onRowClick?: (data: TData) => void
  initialSorting?: SortingState
}

export function DataTable<TData, TValue>({
  columns,
  data,
  autoFocusColumnId,
  onRowClick,
  initialSorting = [],
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: setGlobalFilter,
    getSubRows: (row: any) => row._children,
    getExpandedRowModel: getExpandedRowModel(),
    state: {
      sorting,
      columnFilters,
      globalFilter,
      expanded: true,
    },
    columnResizeMode: 'onChange',
    initialState: {
        pagination: {
            pageSize: 50,
        }
    }
  });

  return (
    <div className="flex flex-col h-full overflow-hidden space-y-2">
      <div className="overflow-auto rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] flex-1">
        <table className="w-full text-sm text-left rtl:text-right text-[var(--vscode-foreground)] table-fixed border-separate border-spacing-0">
          <thead className="text-xs uppercase bg-[var(--vscode-sideBarSectionHeader-background)] text-[var(--vscode-foreground)] shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <th 
                      key={header.id} 
                      className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] group bg-[var(--vscode-sideBarSectionHeader-background)]"
                      style={{ width: header.getSize(), position: 'sticky', top: 0, zIndex: 10 }}
                    >
                      {header.isPlaceholder ? null : (
                        <div className="space-y-2">
                            <div
                                className={`flex items-center space-x-2 ${
                                header.column.getCanSort()
                                    ? 'cursor-pointer select-none hover:text-[var(--vscode-list-hoverForeground)]'
                                    : ''
                                }`}
                                onClick={header.column.getToggleSortingHandler()}
                            >
                                <span>
                                    {flexRender(
                                        header.column.columnDef.header,
                                        header.getContext()
                                    )}
                                </span>
                                {header.column.getCanSort() && (
                                    <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />
                                )}
                            </div>
                            {/* Column Filter Input */}
                            {header.column.getCanFilter() ? (
                                <div>
                                    <input
                                        type="text"
                                        autoFocus={header.column.id === autoFocusColumnId}
                                        value={(header.column.getFilterValue() ?? '') as string}
                                        onChange={(e) => header.column.setFilterValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') {
                                                e.currentTarget.blur();
                                            }
                                        }}
                                        placeholder={`Filter...`}
                                        className="w-full px-2 py-1 text-xs border rounded bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] text-[var(--vscode-input-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)]"
                                        onClick={(e) => e.stopPropagation()} // Prevent sorting when clicking input
                                    />
                                </div>
                            ) : null}
                        </div>
                      )}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-[var(--vscode-widget-border)] opacity-0 group-hover:opacity-100 ${
                            header.column.getIsResizing() ? 'opacity-100 bg-[var(--vscode-focusBorder)]' : ''
                          }`}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[var(--vscode-widget-border)]">
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={`bg-[var(--vscode-editor-background)] transition-colors ${
                    onRowClick ? 'cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]' : 'hover:bg-[var(--vscode-list-hoverBackground)]'
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td 
                      key={cell.id} 
                      className="px-4 py-2 break-words align-top border-r border-[var(--vscode-widget-border)]"
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-24 text-center text-[var(--vscode-disabledForeground)]">
                  No results.
                </td>
              </tr>
            )}
          </tbody>
          {table.getFooterGroups().some(fg => fg.headers.some(h => h.column.getIsVisible() && h.column.columnDef.footer)) && (
             <tfoot className="bg-[var(--vscode-sideBarSectionHeader-background)] font-medium text-[var(--vscode-foreground)] border-t border-[var(--vscode-widget-border)] sticky bottom-0 z-10 shadow-sm">
               {table.getFooterGroups().map((footerGroup) => (
                 <tr key={footerGroup.id}>
                   {footerGroup.headers.map((header) => (
                     <td key={header.id} className="px-4 py-3 whitespace-nowrap">
                       {header.isPlaceholder
                         ? null
                         : flexRender(
                             header.column.columnDef.footer,
                             header.getContext()
                           )}
                     </td>
                   ))}
                 </tr>
               ))}
             </tfoot>
           )}
        </table>
      </div>

       {/* Pagination */}
       {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between px-2 py-2 border-t border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBarSectionHeader-background)] text-xs text-[var(--vscode-foreground)]">
             <div className="flex items-center space-x-2">
                <span className="flex items-center gap-1">
                    <div>Page</div>
                    <strong>
                        {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                    </strong>
                </span>
                <span className="hidden sm:inline-block opacity-50">|</span>
                <span className="hidden sm:flex items-center gap-1">
                    Go to page:
                    <input
                        type="number"
                        min="1"
                        max={table.getPageCount()}
                        value={table.getState().pagination.pageIndex + 1}
                        onChange={e => {
                            const page = e.target.value ? Number(e.target.value) - 1 : 0;
                            table.setPageIndex(page);
                        }}
                        className="border p-1 rounded w-16 bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] appearance-none m-0"
                    />
                </span>
                <select
                    value={table.getState().pagination.pageSize}
                    onChange={e => {
                        table.setPageSize(Number(e.target.value));
                    }}
                    className="border p-1 rounded bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
                >
                    {[10, 20, 30, 40, 50, 100].map(pageSize => (
                        <option key={pageSize} value={pageSize}>
                            Show {pageSize}
                        </option>
                    ))}
                </select>
             </div>
            <div className="flex items-center space-x-1">
                <button
                    className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => table.setPageIndex(0)}
                    disabled={!table.getCanPreviousPage()}
                >
                    <ChevronsLeft className="h-4 w-4" />
                </button>
                <button
                    className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
                <button
                    className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    disabled={!table.getCanNextPage()}
                >
                    <ChevronsRight className="h-4 w-4" />
                </button>
            </div>
        </div>
      )}

    </div>
  );
}
