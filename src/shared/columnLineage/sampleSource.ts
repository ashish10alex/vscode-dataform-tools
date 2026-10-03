import type { ColumnsInput } from './columnsController';
import type { ImpactCandidate } from './impactSummary';
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
        ['marts_assertions.fct_daily_revenue_assertions_uniqueKey_0#revenue_usd', 'OTHER'],
        ['marts_assertions.fct_daily_revenue_assertions_rowConditions#revenue_usd', 'OTHER'],
    ],
    'reporting.revenue_dashboard#revenue_usd': [
        ['reporting.exec_summary#revenue_usd', 'EXACT_COPY'],
        ['reporting.revenue_by_region#revenue_usd', 'OTHER'],
    ],
    'marts.fct_daily_revenue#order_date': [
        ['reporting.revenue_dashboard#order_date', 'EXACT_COPY'],
        ['finance.monthly_close#close_month', 'OTHER'],
    ],
    'marts.fct_daily_revenue#region': [['reporting.revenue_by_region#region', 'EXACT_COPY']],
    'marts.fct_daily_revenue#order_count': [['reporting.exec_summary#orders_per_day', 'OTHER']],
    'finance.monthly_close#total_revenue': [['finance.board_pack#q_revenue', 'OTHER']],
    'ml.customer_ltv_features#ltv_90d': [
        ['ml.churn_training_set#ltv_90d', 'EXACT_COPY'],
        ['ml.ltv_scoring_daily#', 'TABLE_ONLY'],
    ],
    // Readers of a table-level reader, reached by expanding it
    'ml.customer_events#user_id': [
        ['ml.session_rollup#user_id', 'EXACT_COPY'],
        ['ml.engagement_scores#events_7d', 'OTHER'],
    ],
};

/** Built-in assertions of the sample project */
const ASSERTIONS = new Set([
    'marts_assertions.fct_daily_revenue_assertions_uniqueKey_0',
    'marts_assertions.fct_daily_revenue_assertions_rowConditions',
]);

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
    'marts_assertions.fct_daily_revenue_assertions_uniqueKey_0': 'definitions/marts/fct_daily_revenue.sqlx',
    'marts_assertions.fct_daily_revenue_assertions_rowConditions': 'definitions/marts/fct_daily_revenue.sqlx',
};

export const SAMPLE_FOCUS: TraceFocus = {
    table: `${PROJECT}.marts.fct_daily_revenue`,
    column: 'revenue_usd',
    change: { kind: 'dropped' },
};

/** Sample columns of the focus table: prod's schema, and a dry run that drops one, retypes one and adds one */
export const SAMPLE_COLUMNS: ColumnsInput = {
    table: SAMPLE_FOCUS.table,
    prod: [
        { name: 'order_date', type: 'DATE' },
        { name: 'region', type: 'STRING' },
        { name: 'revenue_usd', type: 'NUMERIC' },
        { name: 'order_count', type: 'INT64' },
        { name: 'avg_basket_usd', type: 'NUMERIC' },
        { name: 'loaded_at', type: 'TIMESTAMP' },
    ],
    dev: [
        { name: 'order_date', type: 'DATE' },
        { name: 'region', type: 'STRING' },
        { name: 'order_count', type: 'STRING' },
        { name: 'avg_basket_usd', type: 'NUMERIC' },
        { name: 'loaded_at', type: 'TIMESTAMP' },
        { name: 'revenue_eur', type: 'NUMERIC' },
    ],
};

function withoutProject(table: string): string {
    return table.startsWith(`${PROJECT}.`) ? table.slice(PROJECT.length + 1) : table;
}

function toLink(key: string, dependencyType: DependencyType): ColumnLink {
    const [table, column] = key.split('#');
    return { table: `${PROJECT}.${table}`, column: column || undefined, dependencyType, ...(ASSERTIONS.has(table) ? { assertion: true } : {}) };
}

export function resolveSampleFile(table: string): string | undefined {
    return FILES[withoutProject(table)];
}

export class SampleTraceSource implements TraceSource {
    readonly kind = 'sample' as const;

    constructor(private readonly latencyMs: [number, number] = [250, 650]) {}

    private wait(factor = 1) {
        const [min, max] = this.latencyMs;
        return new Promise((resolve) => setTimeout(resolve, factor * (min + Math.random() * (max - min))));
    }

    async links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]> {
        await this.wait();
        const key = `${withoutProject(table)}#${column}`;
        if (direction === 'downstream') {
            return (READS[key] ?? []).filter(([, type]) => type !== 'TABLE_ONLY').map(([reader, type]) => toLink(reader, type));
        }
        return Object.entries(READS)
            .filter(([, readers]) => readers.some(([reader]) => reader === key))
            .map(([source, readers]) => toLink(source, readers.find(([reader]) => reader === key)![1]));
    }

    /** Slower than {@link links}, like Dataplex's table-level search and probes */
    async tableOnlyReaders(table: string, linked: Set<string>): Promise<ColumnLink[]> {
        await this.wait(3);
        const prefix = `${withoutProject(table)}#`;
        const readers = Object.entries(READS)
            .filter(([key]) => key.startsWith(prefix))
            .flatMap(([, links]) => links.filter(([, type]) => type === 'TABLE_ONLY').map(([reader]) => toLink(reader, 'TABLE_ONLY')))
            .filter((link) => !linked.has(link.table));
        return [...new Map(readers.map((link) => [link.table, link])).values()];
    }

    async tableReaders(table: string): Promise<ColumnLink[]> {
        await this.wait();
        const prefix = `${withoutProject(table)}#`;
        const readers = Object.entries(READS)
            .filter(([key]) => key.startsWith(prefix))
            .flatMap(([, links]) => links.map(([reader]) => toLink(reader.split('#')[0], 'TABLE_ONLY')));
        return [...new Map(readers.map((link) => [link.table, link])).values()];
    }
}

/** A sample branch for previewing the column impact summary: what it changes, deletes and couldn't check */
export const SAMPLE_IMPACT: { candidates: ImpactCandidate[]; changed: Set<string>; sql: Record<string, string> } = {
    candidates: [
        { table: SAMPLE_FOCUS.table, fileName: FILES['marts.fct_daily_revenue'], type: 'table', prod: SAMPLE_COLUMNS.prod, dev: SAMPLE_COLUMNS.dev },
        { table: `${PROJECT}.staging.raw_orders_cleaned`, fileName: FILES['staging.raw_orders_cleaned'], type: 'table', deleted: true },
        {
            table: `${PROJECT}.reporting.revenue_dashboard`,
            fileName: FILES['reporting.revenue_dashboard'],
            type: 'view',
            prod: [{ name: 'order_date', type: 'DATE' }, { name: 'revenue_usd', type: 'NUMERIC' }],
            dev: [{ name: 'order_date', type: 'DATE' }, { name: 'revenue_usd', type: 'NUMERIC' }, { name: 'revenue_eur', type: 'NUMERIC' }],
        },
        {
            table: `${PROJECT}.reporting.exec_summary`,
            fileName: FILES['reporting.exec_summary'],
            type: 'table',
            prod: [{ name: 'revenue_usd', type: 'NUMERIC' }, { name: 'orders_per_day', type: 'INT64' }],
            dev: [{ name: 'revenue_usd', type: 'NUMERIC' }, { name: 'orders_per_day', type: 'INT64' }],
        },
        { table: `${PROJECT}.ml.customer_ltv_features`, fileName: FILES['ml.customer_ltv_features'], type: 'incremental', uncheckedReason: 'dry run failed: Unrecognized name: revenue_usd at [12:5]' },
        { table: `${PROJECT}.staging.fx_backfill`, type: 'operations', uncheckedReason: 'operation: a dry run of a script has no schema' },
    ],
    changed: new Set([`${PROJECT}.reporting.revenue_dashboard`, `${PROJECT}.reporting.exec_summary`, `${PROJECT}.ml.customer_ltv_features`]),
    sql: {
        [`${PROJECT}.reporting.revenue_dashboard`]: 'SELECT order_date, revenue_usd, revenue_eur FROM `acme-prod.marts.fct_daily_revenue`',
        [`${PROJECT}.reporting.exec_summary`]: 'SELECT revenue_usd, CAST(order_total AS INT64) AS orders_per_day FROM `acme-prod.marts.fct_daily_revenue`',
    },
};
