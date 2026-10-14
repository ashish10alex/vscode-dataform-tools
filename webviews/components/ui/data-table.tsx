import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  ExpandedState,
  OnChangeFn,
  PaginationState,
  Updater,
  Column,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * A table whose rows are held elsewhere: `data` is one page of them, and paging, sorting and filtering are asked
 * of the holder through `onChange`, which is given what changed.
 */
export interface ServerTable {
  /** Rows there are in all, once filtered */
  rowCount: number
  pageIndex: number
  pageSize: number
  sorting: SortingState
  columnFilters: ColumnFiltersState
  onChange: (change: Partial<Pick<ServerTable, 'pageIndex' | 'pageSize' | 'sorting' | 'columnFilters'>>) => void
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchPlaceholder?: string
  autoFocusColumnId?: string
  onRowClick?: (data: TData) => void
  initialSorting?: SortingState
  /** Render with pagination controls + page-size dropdown. Defaults to true. */
  paginated?: boolean
  /** Returns child rows for tree data. Defaults to `row._children`. */
  getSubRows?: (row: TData) => TData[] | undefined
  /**
   * Controlled expanded state for tree data. When omitted, all rows are always expanded.
   * While a filter is active every row is shown expanded, and matching child rows keep their parents;
   * the stored state is restored once filters are cleared.
   */
  expanded?: ExpandedState
  onExpandedChange?: OnChangeFn<ExpandedState>
  /** Where the row built from the columns' `footer` defs goes. Defaults to 'bottom'. */
  footerPosition?: 'top' | 'bottom'
  /** Keeps the first column in view while the table is scrolled sideways: for a table whose first column names the row */
  stickyFirstColumn?: boolean
  /** Shown at the start of the bar under the table, which is then drawn even when there is a single page */
  status?: ReactNode
  /** Given when `data` is one page of rows held elsewhere */
  server?: ServerTable
}

function ColumnFilterInput({ column, shouldAutoFocus, applyOnEnter }: { column: Column<any, unknown>; shouldAutoFocus: boolean; applyOnEnter: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const applied = (column.getFilterValue() ?? '') as string;
  // What is typed is held here until Enter or leaving the field, when each filter asked for is a query to run
  const [draft, setDraft] = useState(applied);
  useEffect(() => setDraft(applied), [applied]);
  const apply = () => {
    if (applyOnEnter && draft !== applied) {
      column.setFilterValue(draft);
    }
  };

  useEffect(() => {
    // Only take focus when the webview already has it. The panel is opened with
    // preserveFocus, so grabbing focus on mount would pull the cursor out of the
    // editor whenever the active file changes.
    if (shouldAutoFocus && document.hasFocus()) {
      inputRef.current?.focus();
    }
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={applyOnEnter ? draft : applied}
      onChange={(e) => applyOnEnter ? setDraft(e.target.value) : column.setFilterValue(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          apply();
        }
        if (e.key === 'Escape') {
          e.currentTarget.blur();
        }
      }}
      placeholder={applyOnEnter ? 'Filter, then Enter' : `Filter...`}
      className="w-full px-2 py-1 text-xs border rounded bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] text-[var(--vscode-input-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)]"
      onClick={(e) => e.stopPropagation()} // Prevent sorting when clicking input
    />
  );
}

/** Which way a column is sorted, or that it can be: a sorted column's arrow is drawn in full */
function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (direction === 'asc') {
    return <ArrowUp aria-label="Sorted ascending" className="w-3 h-3 ml-1 shrink-0 text-[var(--vscode-focusBorder)]" />;
  }
  if (direction === 'desc') {
    return <ArrowDown aria-label="Sorted descending" className="w-3 h-3 ml-1 shrink-0 text-[var(--vscode-focusBorder)]" />;
  }
  return <ArrowUpDown className="w-3 h-3 ml-1 shrink-0 opacity-50" />;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  autoFocusColumnId,
  onRowClick,
  initialSorting = [],
  paginated = true,
  getSubRows = (row: any) => row._children,
  expanded,
  onExpandedChange,
  footerPosition = 'bottom',
  stickyFirstColumn = false,
  status,
  server,
}: DataTableProps<TData, TValue>) {
  const [ownSorting, setOwnSorting] = useState<SortingState>(initialSorting);
  const [ownColumnFilters, setOwnColumnFilters] = useState<ColumnFiltersState>([]);
  const [ownPagination, setOwnPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const sorting = server ? server.sorting : ownSorting;
  const columnFilters = server ? server.columnFilters : ownColumnFilters;
  const pagination = server ? { pageIndex: server.pageIndex, pageSize: server.pageSize } : ownPagination;
  const resolve = <T,>(updater: Updater<T>, current: T): T => typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater;
  const setSorting: OnChangeFn<SortingState> = server
    ? (updater) => server.onChange({ sorting: resolve(updater, server.sorting) })
    : setOwnSorting;
  const setColumnFilters: OnChangeFn<ColumnFiltersState> = server
    ? (updater) => server.onChange({ columnFilters: resolve(updater, server.columnFilters) })
    : setOwnColumnFilters;
  const setPagination: OnChangeFn<PaginationState> = server
    ? (updater) => {
        const next = resolve(updater, { pageIndex: server.pageIndex, pageSize: server.pageSize });
        server.onChange(next.pageSize !== server.pageSize ? { pageSize: next.pageSize, pageIndex: 0 } : { pageIndex: next.pageIndex });
      }
    : setOwnPagination;
  const [globalFilter, setGlobalFilter] = useState('');
  const isTree = expanded !== undefined;
  const isFiltering = globalFilter !== '' || columnFilters.some((f) => f.value !== undefined && f.value !== '');

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Skip the pagination row model entirely when disabled so the table just
    // renders the filtered rows in full.
    ...(paginated ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: setGlobalFilter,
    getSubRows,
    getExpandedRowModel: getExpandedRowModel(),
    ...(isTree ? {
      // Keep a parent row when one of its children matches the filter.
      filterFromLeafRows: true,
      // Page by top-level rows so a parent's children stay on the same page.
      paginateExpandedRows: false,
      // Ignore toggles while filtering so the stored state is restored when filters are cleared.
      onExpandedChange: isFiltering ? () => {} : onExpandedChange,
    } : {}),
    // Given in both modes: the table keeps an option it is no longer given, so a table that held rows elsewhere
    // would go on leaving the paging, sorting and filtering to the holder after it is given rows of its own
    manualPagination: !!server,
    manualSorting: !!server,
    manualFiltering: !!server,
    rowCount: server?.rowCount,
    onPaginationChange: setPagination,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      expanded: isTree && !isFiltering ? expanded : true,
      pagination,
    },
    columnResizeMode: 'onChange',
    initialState: {
        pagination: {
            pageSize: 50,
        }
    }
  });

  // A cell that stays put is drawn over the ones that scroll under it, so it has a background of its own; the row's
  // hover colour, which may be see-through, is laid over that
  const stuck = (index: number, background: string) => stickyFirstColumn && index === 0
    ? ` sticky left-0 z-[5] ${background} group-hover/row:[background-image:linear-gradient(var(--vscode-list-hoverBackground),var(--vscode-list-hoverBackground))]`
    : '';
  const hasPager = paginated && table.getPageCount() > 1;
  const hasFooter = table.getFooterGroups().some(fg => fg.headers.some(h => h.column.getIsVisible() && h.column.columnDef.footer));

  return (
    <div className="flex flex-col h-full overflow-hidden space-y-2">
      <div className="overflow-auto rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] flex-1">
        <table className="w-full text-sm text-left rtl:text-right text-[var(--vscode-foreground)] table-fixed border-separate border-spacing-0">
          <thead className="text-xs uppercase bg-[var(--vscode-sideBarSectionHeader-background)] text-[var(--vscode-foreground)] shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => {
                  return (
                    <th 
                      key={header.id}
                      aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}
                      className="px-4 py-3 font-medium border-b border-[var(--vscode-widget-border)] group bg-[var(--vscode-sideBarSectionHeader-background)]"
                      style={{ width: header.getSize(), position: 'sticky', top: 0, zIndex: 10, ...(stickyFirstColumn && index === 0 ? { left: 0, zIndex: 11 } : {}) }}
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
                                {header.column.getCanSort() && <SortIcon direction={header.column.getIsSorted()} />}
                            </div>
                            {/* Column Filter Input */}
                            {header.column.getCanFilter() ? (
                                <div>
                                    <ColumnFilterInput
                                        column={header.column}
                                        shouldAutoFocus={header.column.id === autoFocusColumnId}
                                        applyOnEnter={!!server}
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
            {hasFooter && footerPosition === 'top' && table.getFooterGroups().map((footerGroup) => (
              <tr key={footerGroup.id} className="bg-[var(--vscode-sideBarSectionHeader-background)] font-medium text-[var(--vscode-foreground)]">
                {footerGroup.headers.map((header, index) => (
                  <td key={header.id} className={`px-4 py-2 break-words align-top border-b border-r border-[var(--vscode-widget-border)]${stuck(index, 'bg-[var(--vscode-sideBarSectionHeader-background)]')}`}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.footer, header.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={`group/row bg-[var(--vscode-editor-background)] transition-colors ${
                    onRowClick ? 'cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]' : 'hover:bg-[var(--vscode-list-hoverBackground)]'
                  }`}
                >
                  {row.getVisibleCells().map((cell, index) => (
                    <td 
                      key={cell.id} 
                      className={`px-4 py-2 break-words align-top border-r border-[var(--vscode-widget-border)]${stuck(index, 'bg-[var(--vscode-editor-background)]')}`}
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
          {hasFooter && footerPosition === 'bottom' && (
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
       {(hasPager || status) && (
        <div className={`flex items-center justify-between px-2 py-2 border-t border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBarSectionHeader-background)] text-xs text-[var(--vscode-foreground)]${status ? ' flex-wrap gap-x-4 gap-y-1' : ''}`}>
          {status}
          {hasPager && (
          <div className={status ? 'flex items-center gap-x-4 ml-auto' : 'contents'}>
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
      )}

    </div>
  );
}
