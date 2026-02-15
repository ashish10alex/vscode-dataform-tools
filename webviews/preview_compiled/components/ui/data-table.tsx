import React, { useState } from 'react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  SortingState,
  ColumnFiltersState,
} from '@tanstack/react-table'
import { ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X } from 'lucide-react'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchPlaceholder?: string
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = "Search..."
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')

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
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    initialState: {
        pagination: {
            pageSize: 50,
        }
    }
  })

  return (
    <div className="flex flex-col h-full overflow-hidden space-y-2">
      <div className="overflow-auto rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex-1">
        <table className="w-full text-sm text-left rtl:text-right text-zinc-500 dark:text-zinc-400">
          <thead className="text-xs text-zinc-700 uppercase bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-400 sticky top-0 z-10 shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <th key={header.id} className="px-4 py-3 font-medium border-b border-zinc-200 dark:border-zinc-700 whitespace-nowrap">
                      {header.isPlaceholder ? null : (
                        <div className="space-y-2">
                            <div
                                className={`flex items-center space-x-2 ${
                                header.column.getCanSort()
                                    ? 'cursor-pointer select-none hover:text-zinc-900 dark:hover:text-zinc-200'
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
                                    <ArrowUpDown className="w-3 h-3 ml-1 text-zinc-400" />
                                )}
                            </div>
                            {/* Column Filter Input */}
                            {header.column.getCanFilter() ? (
                                <div>
                                    <input
                                        type="text"
                                        value={(header.column.getFilterValue() ?? '') as string}
                                        onChange={(e) => header.column.setFilterValue(e.target.value)}
                                        placeholder={`Filter...`}
                                        className="w-full px-2 py-1 text-xs border rounded bg-zinc-50 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                                        onClick={(e) => e.stopPropagation()} // Prevent sorting when clicking input
                                    />
                                </div>
                            ) : null}
                        </div>
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2 break-words align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-24 text-center">
                  No results.
                </td>
              </tr>
            )}
          </tbody>
          {table.getFooterGroups().some(fg => fg.headers.some(h => h.column.getIsVisible() && h.column.columnDef.footer)) && (
             <tfoot className="bg-zinc-50 dark:bg-zinc-800 font-medium text-zinc-900 dark:text-zinc-200 border-t border-zinc-200 dark:border-zinc-700 sticky bottom-0 z-10 shadow-sm">
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
        <div className="flex items-center justify-between px-2 py-2 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-500 dark:text-zinc-400">
             <div className="flex items-center space-x-2">
                <span className="flex items-center gap-1">
                    <div>Page</div>
                    <strong>
                        {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                    </strong>
                </span>
                <span className="hidden sm:inline-block text-zinc-400">|</span>
                <span className="hidden sm:flex items-center gap-1">
                    Go to page:
                    <input
                        type="number"
                        min="1"
                        max={table.getPageCount()}
                        defaultValue={table.getState().pagination.pageIndex + 1}
                        onChange={e => {
                            const page = e.target.value ? Number(e.target.value) - 1 : 0
                            table.setPageIndex(page)
                        }}
                        className="border p-1 rounded w-16 bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none m-0"
                    />
                </span>
                <select
                    value={table.getState().pagination.pageSize}
                    onChange={e => {
                        table.setPageSize(Number(e.target.value))
                    }}
                    className="border p-1 rounded bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => table.setPageIndex(0)}
                    disabled={!table.getCanPreviousPage()}
                >
                    <ChevronsLeft className="h-4 w-4" />
                </button>
                <button
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
                <button
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    disabled={!table.getCanNextPage()}
                >
                    <ChevronsRight className="h-4 w-4" />
                </button>
            </div>
        </div>
      )}
    </div>
  )
}
