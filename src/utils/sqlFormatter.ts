import { format } from 'sql-formatter';

export function formatSqlQuery(sql: string, maxLineLength = 120): string {
    return format(sql, {
        language: 'bigquery',
        tabWidth: 2,
        linesBetweenQueries: 1,
        expressionWidth: maxLineLength,
    });
}
