import React from 'react';
import { ExternalLink } from "lucide-react";
import { getUrlToNavigateToTableInBigQuery, parseBigQueryTableId } from '../utils/bigquery';

interface BigQueryTableLinkProps {
  id: any;
  label?: string;
  className?: string;
  showIcon?: boolean;
  fallbackClassName?: string;
}

export const BigQueryTableLink: React.FC<BigQueryTableLinkProps> = ({
  id,
  label,
  className = "text-zinc-600 dark:text-zinc-300 font-mono select-all hover:text-blue-600 dark:hover:text-blue-400 transition-colors",
  showIcon = false,
  fallbackClassName = "text-zinc-400 dark:text-zinc-500 font-mono italic"
}) => {
  const parsed = parseBigQueryTableId(id);
  const displayLabel = label || (parsed ? `${parsed.database}.${parsed.schema}.${parsed.name}` : (typeof id === 'string' ? id : 'Invalid ID'));

  if (!parsed) {
    return (
      <span className={fallbackClassName}>
        {displayLabel} (Invalid Format)
      </span>
    );
  }

  return (
    <a
      href={getUrlToNavigateToTableInBigQuery(parsed.database, parsed.schema, parsed.name)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {showIcon && <ExternalLink className="w-4 h-4 mr-2" />}
      {displayLabel}
    </a>
  );
};
