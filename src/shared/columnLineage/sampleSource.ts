import { ColumnLink, DependencyType, LineageDirection, TraceFocus, TraceSource } from './types';

// Example lineage for previewing the trace panel in a plain browser, where there is no Dataplex to ask.

const PROJECT = 'acme-prod';

/** Downstream links, written as `table#column` → readers */
const READS: Record<string, [string, DependencyType][]> = {
    'staging.raw_orders_cleaned#amt_cents': [['staging.stg_orders#amount_usd', 'OTHER']],
    'raw.orders#amt_cents': [['staging.raw_orders_cleaned#amt_cents', 'EXACT_COPY']],
    'raw.fx_rates#usd_rate': [['staging.stg_orders#amount_usd', 'OTHER']],
    'staging.stg_orders#amount_usd': [['marts.fct_daily_revenue#revenue_usd', 'OTHER']],
    'marts.fct_daily_revenue#revenue_usd': [
        ['reporting.revenue_dashboard#revenue_usd', 'EXACT_COPY'],
        ['finance.monthly_close#total_revenue', 'OTHER'],
        ['ml.customer_ltv_features#ltv_90d', 'OTHER'],
        ['ml.customer_events#', 'TABLE_ONLY'],
    ],
    'reporting.revenue_dashboard#revenue_usd': [
        ['reporting.exec_summary#revenue_usd', 'EXACT_COPY'],
        ['reporting.revenue_by_region#revenue_usd', 'OTHER'],
    ],
    'finance.monthly_close#total_revenue': [['finance.board_pack#q_revenue', 'OTHER']],
    'ml.customer_ltv_features#ltv_90d': [
        ['ml.churn_training_set#ltv_90d', 'EXACT_COPY'],
        ['ml.ltv_scoring_daily#', 'TABLE_ONLY'],
    ],
};

/** Tables that are actions in the sample project, with their files. The rest are outside the project. */
const FILES: Record<string, string> = {
    'staging.raw_orders_cleaned': 'definitions/staging/raw_orders_cleaned.sqlx',
    'staging.stg_orders': 'definitions/staging/stg_orders.sqlx',
    'marts.fct_daily_revenue': 'definitions/marts/fct_daily_revenue.sqlx',
    'reporting.revenue_dashboard': 'definitions/reporting/revenue_dashboard.sqlx',
    'reporting.exec_summary': 'definitions/reporting/exec_summary.sqlx',
    'reporting.revenue_by_region': 'definitions/reporting/revenue_by_region.sqlx',
    'ml.customer_ltv_features': 'definitions/ml/customer_ltv_features.sqlx',
    'ml.customer_events': 'definitions/ml/customer_events.sqlx',
};

export const SAMPLE_FOCUS: TraceFocus = {
    table: `${PROJECT}.marts.fct_daily_revenue`,
    column: 'revenue_usd',
    change: { kind: 'dropped' },
};

function withoutProject(table: string): string {
    return table.startsWith(`${PROJECT}.`) ? table.slice(PROJECT.length + 1) : table;
}

function toLink(key: string, dependencyType: DependencyType): ColumnLink {
    const [table, column] = key.split('#');
    return { table: `${PROJECT}.${table}`, column: column || undefined, dependencyType };
}

export function resolveSampleFile(table: string): string | undefined {
    return FILES[withoutProject(table)];
}

export class SampleTraceSource implements TraceSource {
    readonly kind = 'sample' as const;

    constructor(private readonly latencyMs: [number, number] = [250, 650]) {}

    async links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]> {
        const [min, max] = this.latencyMs;
        await new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
        const key = `${withoutProject(table)}#${column}`;
        if (direction === 'downstream') {
            return (READS[key] ?? []).map(([reader, type]) => toLink(reader, type));
        }
        return Object.entries(READS)
            .filter(([, readers]) => readers.some(([reader]) => reader === key))
            .map(([source, readers]) => toLink(source, readers.find(([reader]) => reader === key)![1]));
    }
}
