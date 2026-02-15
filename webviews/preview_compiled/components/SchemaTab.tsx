import React, { useEffect, useRef } from 'react';
import { WebviewState } from '../types';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator.min.css'; // Import default styles, overridden by index.css

interface SchemaTabProps {
  state: WebviewState;
}

export const SchemaTab: React.FC<SchemaTabProps> = ({ state }) => {
  const tableRef = useRef<HTMLDivElement>(null);
  const tabulatorRef = useRef<any | null>(null);

  useEffect(() => {
    if (state.compiledQuerySchema && tableRef.current) {
        
      // If table already exists, just update data? 
      // Tabulator is a bit heavy, safe to destroy and recreate or update data.
      // Recreating ensures columns are correct if schema changes.
      if(tabulatorRef.current){
          tabulatorRef.current.destroy();
      }

      tabulatorRef.current = new Tabulator(tableRef.current, {
        data: state.compiledQuerySchema.fields,
        layout: "fitColumns",
        columns: [
          { title: "Name", field: "name", headerFilter: "input" },
          { title: "Type", field: "type", headerFilter: "input" },
          { 
              title: "Description", 
              field: "description", 
              editor: "input",
              widthGrow: 2, 
          },
        ],
        height: "100%", // Fit container
        pagination: "local",
        paginationSize: 50,
        paginationCounter: "rows",
        movableRows: false,
      });

      // Event listener for cell edit
      tabulatorRef.current.on("cellEdited", (cell: any) => {
          const row = cell.getRow();
          const fieldName = row.getData().name;
          const newDescription = cell.getValue();
          // Logic to update description JSON would go here
          // For now, we just log it or we could expose a callback prop to parent
          console.log(`Updated description for ${fieldName}: ${newDescription}`);
          
          // In the original, it updated a code block with JSON. 
          // We might want to add that visualization back if needed.
      });
    }
  }, [state.compiledQuerySchema]);

  if (!state.compiledQuerySchema || state.compiledQuerySchema.fields.length === 0) {
    return (
        <div className="p-8 text-center text-zinc-500">
            <p>No schema available.</p>
        </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
       <div className="mb-4 text-sm text-zinc-400">
          <i>Edit description to update documentation.</i>
       </div>
      <div ref={tableRef} className="flex-1 overflow-hidden" />
    </div>
  );
};
