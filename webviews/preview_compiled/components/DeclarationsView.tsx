import React from 'react';
import { Declarations } from '../types';

interface DeclarationsViewProps {
  declarations: Declarations[];
}

export const DeclarationsView: React.FC<DeclarationsViewProps> = ({ declarations }) => {
  const groupedBySchema = declarations.reduce((acc: Record<string, Declarations[]>, declaration: Declarations) => {
    const schema: string = declaration.target.schema;
    const database: string = declaration.target.database;
    const key = `${database}.${schema}`;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(declaration);
    return acc;
  }, {});

  return (
    <div className="p-4 text-zinc-800 dark:text-zinc-300">
      <h2 className="text-xl font-bold mb-4">Declarations</h2>
      {Object.entries(groupedBySchema).map(([key, groupDeclarations]) => (
        <div key={key} className="mb-6">
          <strong className="text-zinc-500 dark:text-zinc-400 block mb-2 border-b border-zinc-200 dark:border-zinc-700 pb-1">{key}</strong>
          <div className="space-y-1">
            {groupDeclarations.map((declaration) => {
              const { database, schema, name } = declaration.target;
              const link = `https://console.cloud.google.com/bigquery?project=${database}&ws=!1m5!1m4!4m3!1s${database}!2s${schema}!3s${name}`;
              return (
                <div key={name}>
                  <a 
                    href={link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 hover:underline"
                  >
                     {database}.{schema}.{name}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {declarations.length === 0 && (
         <div className="text-zinc-500">No declarations found for this file.</div>
      )}
    </div>
  );
};
