import * as assert from 'assert';
import { suite, test } from 'mocha';
import { addHop, canExpand, copiesOnly, frontier, initialTraceState, pathToFocus, removeUpstream, traceNodeId, traceRows } from '../../shared/columnLineage/traceGraph';
import { TraceController } from '../../shared/columnLineage/traceController';
import { Limiter } from '../../shared/columnLineage/limiter';
import { cardLinks, cardSummary, linkKind, linkLabel, opensByDefault, traceCards } from '../../shared/columnLineage/traceCards';
import { SAMPLE_FOCUS, SampleTraceSource } from '../../shared/columnLineage/sampleSource';
import { graphNeighbours, guessColumnLinks, indexGraph } from '../../shared/columnLineage/graphLinks';
import { columnLinksFromApi, isTempTable, lineageField, lineageFqn, tablesFromApi, untrackedReaders } from '../../shared/columnLineage/dataplexLinks';
import { ColumnLink, LineageDirection, TraceSource, TraceState } from '../../shared/columnLineage/types';

const focus = { table: 'p.marts.fct', column: 'revenue' };
const focusId = traceNodeId(focus.table, focus.column);

suite('Column lineage trace graph', () => {
    test('adds downstream readers one hop out and marks the focus expanded', () => {
        const state = addHop(initialTraceState(focus, 'sample'), focusId, 'downstream', [
            { table: 'p.rep.dash', column: 'revenue', dependencyType: 'EXACT_COPY' },
            { table: 'p.ml.events', dependencyType: 'TABLE_ONLY' },
        ], (table) => (table === 'p.rep.dash' ? 'definitions/dash.sqlx' : undefined));

        const dash = state.nodes.find((node) => node.id === 'p.rep.dash#revenue')!;
        const events = state.nodes.find((node) => node.id === 'p.ml.events#')!;
        assert.strictEqual(dash.hop, 1);
        assert.strictEqual(dash.filePath, 'definitions/dash.sqlx');
        assert.strictEqual(events.kind, 'tableOnly');
        assert.strictEqual(canExpand(events), true, 'expands to the tables that read it, when asked');
        assert.deepStrictEqual(frontier(state, 'downstream').map((node) => node.id), ['p.rep.dash#revenue'], 'but not with the rest of the hop');
        assert.deepStrictEqual(state.edges.map((edge) => [edge.source, edge.target]), [[focusId, 'p.rep.dash#revenue'], [focusId, 'p.ml.events#']]);
        assert.strictEqual(state.nodes[0].expanded, true);
        assert.strictEqual(state.lookups, 1);
    });

    test('points upstream edges downstream and leaves the focus unexpanded', () => {
        const state = addHop(initialTraceState(focus, 'sample'), focusId, 'upstream', [
            { table: 'p.stg.orders', column: 'amount', dependencyType: 'OTHER' },
        ]);
        assert.strictEqual(state.nodes[1].hop, -1);
        assert.deepStrictEqual([state.edges[0].source, state.edges[0].target], ['p.stg.orders#amount', focusId]);
        assert.strictEqual(state.nodes[0].expanded, false);
    });

    test('keeps a column reached by two paths once, with both edges', () => {
        let state: TraceState = addHop(initialTraceState(focus, 'sample'), focusId, 'downstream', [
            { table: 'p.a.t', column: 'x', dependencyType: 'OTHER' },
            { table: 'p.b.t', column: 'y', dependencyType: 'OTHER' },
        ]);
        state = addHop(state, 'p.a.t#x', 'downstream', [{ table: 'p.c.t', column: 'z', dependencyType: 'EXACT_COPY' }]);
        state = addHop(state, 'p.b.t#y', 'downstream', [{ table: 'p.c.t', column: 'z', dependencyType: 'OTHER' }]);
        assert.strictEqual(state.nodes.filter((node) => node.id === 'p.c.t#z').length, 1);
        assert.strictEqual(state.edges.filter((edge) => edge.target === 'p.c.t#z').length, 2);

        const path = pathToFocus(state, 'p.c.t#z');
        assert.deepStrictEqual([...path.nodes].sort(), [focusId, 'p.a.t#x', 'p.b.t#y', 'p.c.t#z'].sort());
        assert.strictEqual(path.edges.size, 4);
    });

    test('the highlighted path stops at the focus instead of crossing to the other side', () => {
        let state: TraceState = addHop(initialTraceState(focus, 'sample'), focusId, 'downstream', [{ table: 'p.a.t', column: 'x', dependencyType: 'OTHER' }]);
        state = addHop({ ...state, upstreamShown: true }, focusId, 'upstream', [{ table: 'p.s.t', column: 'w', dependencyType: 'OTHER' }]);
        assert.deepStrictEqual([...pathToFocus(state, 'p.a.t#x').nodes].sort(), [focusId, 'p.a.t#x'].sort());
        assert.deepStrictEqual([...pathToFocus(state, 'p.s.t#w').nodes].sort(), [focusId, 'p.s.t#w'].sort());
    });

    test('copies only keeps copy and table-level links, and the columns they still reach', () => {
        let state: TraceState = addHop(initialTraceState(focus, 'sample'), focusId, 'downstream', [
            { table: 'p.rpt.top_scorers', column: 'player_id', dependencyType: 'EXACT_COPY' },
            { table: 'p.rpt.league_table', column: 'points', dependencyType: 'OTHER' },
            { table: 'p.rpt.match_events', dependencyType: 'TABLE_ONLY' },
        ]);
        state = addHop(state, 'p.rpt.league_table#points', 'downstream', [{ table: 'p.rpt.season', column: 'points', dependencyType: 'EXACT_COPY' }]);
        state = addHop({ ...state, upstreamShown: true }, focusId, 'upstream', [
            { table: 'p.raw.matches', column: 'revenue', dependencyType: 'EXACT_COPY' },
            { table: 'p.raw.matches', column: 'home_team', dependencyType: 'OTHER' },
        ]);
        const filtered = copiesOnly(state);
        assert.deepStrictEqual(filtered.nodes.map((node) => node.id).sort(), [
            focusId, 'p.raw.matches#revenue', 'p.rpt.match_events#', 'p.rpt.top_scorers#player_id',
        ].sort());
        assert.ok(filtered.edges.every((edge) => edge.dependencyType !== 'OTHER'));
    });

    test('removing upstream drops only the upstream side', () => {
        let state: TraceState = addHop(initialTraceState(focus, 'sample'), focusId, 'downstream', [{ table: 'p.a.t', column: 'x', dependencyType: 'OTHER' }]);
        state = addHop({ ...state, upstreamShown: true }, focusId, 'upstream', [{ table: 'p.s.t', column: 'w', dependencyType: 'OTHER' }]);
        const trimmed = removeUpstream(state);
        assert.deepStrictEqual(trimmed.nodes.map((node) => node.id), [focusId, 'p.a.t#x']);
        assert.strictEqual(trimmed.edges.length, 1);
        assert.strictEqual(trimmed.upstreamShown, false);
    });
});

/** Waits until no table-level reader lookups are running */
async function readersChecked(controller: TraceController) {
    while (controller.current?.nodes.some((node) => node.checkingReaders)) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

suite('Column lineage trace controller', () => {
    test('opens with several hops loaded, lists them, and toggles upstream against the sample source', async () => {
        const states: TraceState[] = [];
        const controller = new TraceController(new SampleTraceSource([0, 0]), (state) => states.push(state));
        await controller.open(SAMPLE_FOCUS);
        await readersChecked(controller);
        const opened = controller.current!;
        assert.ok(states.some((state) => state.nodes[0].loading), 'reports a loading state before the links arrive');
        assert.strictEqual(opened.nodes.filter((node) => node.hop === 1 && !node.assertion).length, 4);
        assert.strictEqual(opened.nodes.filter((node) => node.hop === 1 && node.assertion).length, 2, 'marks assertions');
        assert.strictEqual(opened.nodes.filter((node) => node.hop === 2).length, 5, 'loads the second hop without being asked');

        const rows = traceRows(opened, 'downstream').filter((row) => !row.node.assertion);
        assert.deepStrictEqual(rows.slice(0, 4).map((row) => [row.node.table.split('.').pop(), row.dependencyType]), [
            ['revenue_dashboard', 'EXACT_COPY'],
            ['monthly_close', 'OTHER'],
            ['customer_ltv_features', 'OTHER'],
            ['customer_events', 'TABLE_ONLY'],
        ]);
        assert.ok(rows.filter((row) => row.node.hop === 2).every((row) => row.via[0].hop === 1));

        await controller.setUpstream(true);
        const upstream = controller.current!;
        assert.deepStrictEqual(upstream.nodes.filter((node) => node.hop < 0).map((node) => node.hop).sort(), [-1, -2, -2, -3]);
        assert.strictEqual(frontier(upstream, 'upstream').length, 1, 'stops after three hops, leaving the next one to load on request');
        await controller.expandLevel('upstream');
        assert.strictEqual(frontier(controller.current!, 'upstream').length, 0);

        await controller.setUpstream(false);
        assert.strictEqual(controller.current!.nodes.filter((node) => node.hop < 0).length, 0);
    });

    test('expands a reader known only at table level to the tables that read it', async () => {
        const controller = new TraceController(new SampleTraceSource([0, 0]), () => undefined);
        await controller.open(SAMPLE_FOCUS);
        await readersChecked(controller);
        const eventsId = 'acme-prod.ml.customer_events#';
        assert.strictEqual(controller.current!.nodes.find((node) => node.id === eventsId)?.expanded, false, 'not expanded with the automatic hops');

        await controller.expand(eventsId);
        const state = controller.current!;
        const readers = state.edges.filter((edge) => edge.source === eventsId);
        assert.deepStrictEqual(readers.map((edge) => [edge.target, edge.dependencyType]).sort(), [
            ['acme-prod.ml.engagement_scores#', 'TABLE_ONLY'],
            ['acme-prod.ml.session_rollup#', 'TABLE_ONLY'],
        ]);
        assert.ok(state.nodes.filter((node) => readers.some((edge) => edge.target === node.id)).every((node) => node.hop === 2 && node.kind === 'tableOnly'));
        assert.strictEqual(state.nodes.find((node) => node.id === eventsId)?.expanded, true);
    });

    test('a table reading itself is not its own next hop', async () => {
        const source: TraceSource = {
            kind: 'sample',
            links: async () => [{ table: 'p.a.inc', dependencyType: 'TABLE_ONLY' }],
            tableReaders: async (table) => [{ table, dependencyType: 'TABLE_ONLY' }, { table: 'p.a.rpt', dependencyType: 'TABLE_ONLY' }],
        };
        const controller = new TraceController(source, () => undefined);
        await controller.open(focus);
        await controller.expand('p.a.inc#');
        assert.deepStrictEqual(controller.current!.edges.filter((edge) => edge.source === 'p.a.inc#').map((edge) => edge.target), ['p.a.rpt#']);
    });

    test('shows column links before readers known only at table level, and loads the next hop without waiting for them', async () => {
        let release: (readers: ColumnLink[]) => void = () => undefined;
        const readers = new Promise<ColumnLink[]>((resolve) => { release = resolve; });
        const source: TraceSource = {
            kind: 'sample',
            links: async (table: string, _column: string, direction: LineageDirection) => (direction === 'downstream' && table === 'p.marts.fct'
                ? [{ table: 'p.rep.dash', column: 'revenue', dependencyType: 'EXACT_COPY' }]
                : []),
            tableOnlyReaders: (table: string) => (table === 'p.marts.fct' ? readers : Promise.resolve([])),
        };
        const controller = new TraceController(source, () => undefined);
        await controller.open(focus);

        const opened = controller.current!;
        assert.ok(opened.nodes.some((node) => node.id === 'p.rep.dash#revenue'), 'column links are in');
        assert.strictEqual(opened.nodes.find((node) => node.hop === 0)!.checkingReaders, true, 'still checking the focus table\'s readers');
        assert.strictEqual(opened.nodes.find((node) => node.id === 'p.rep.dash#revenue')!.expanded, true, 'the next hop loaded meanwhile');
        assert.ok(!opened.nodes.some((node) => node.loading), 'nothing is loading a hop');

        release([{ table: 'p.ml.events', dependencyType: 'TABLE_ONLY' }]);
        await readersChecked(controller);
        const done = controller.current!;
        assert.strictEqual(done.nodes.find((node) => node.hop === 0)!.checkingReaders, false);
        assert.strictEqual(done.nodes.find((node) => node.id === 'p.ml.events#')?.hop, 1, 'table-level readers join the first hop');
    });

    test('a paused trace starts no lookups, and picks up the hops and reader checks it missed on resume', async () => {
        const controller = new TraceController(new SampleTraceSource([0, 0]), () => undefined);
        const opening = controller.open(SAMPLE_FOCUS);
        controller.pause();
        await opening;
        await readersChecked(controller);
        const paused = controller.current!;
        assert.ok(paused.nodes.some((node) => node.hop === 1), 'the lookup in flight still lands');
        assert.ok(!paused.nodes.some((node) => node.hop === 2), 'no next hop while paused');
        assert.ok(!paused.nodes.some((node) => node.kind === 'tableOnly'), 'no reader checks while paused');

        await controller.resume();
        await readersChecked(controller);
        const resumed = controller.current!;
        assert.strictEqual(resumed.nodes.filter((node) => node.hop === 2).length, 5, 'loads the missing hops');
        assert.ok(resumed.nodes.some((node) => node.id.endsWith('ml.customer_events#')), 'runs the held reader check');
    });

        test('reports a failed table-level reader lookup on the node, keeping its column links', async () => {
        const source: TraceSource = {
            kind: 'sample',
            links: async () => [{ table: 'p.rep.dash', column: 'revenue', dependencyType: 'EXACT_COPY' }],
            tableOnlyReaders: async () => { throw new Error('quota exceeded'); },
        };
        const controller = new TraceController(source, () => undefined);
        await controller.open(focus);
        await readersChecked(controller);
        const focusNode = controller.current!.nodes.find((node) => node.hop === 0)!;
        assert.strictEqual(focusNode.readersError, 'quota exceeded');
        assert.strictEqual(focusNode.error, undefined);
        assert.ok(controller.current!.nodes.some((node) => node.id === 'p.rep.dash#revenue'));
    });
});

suite('Column lineage from the dependency graph', () => {
    const graph = {
        tables: [
            { type: 'table', target: { database: 'p', schema: 'mart', name: 'player_stats' }, fileName: 'definitions/player_stats.sqlx', dependencyTargets: [{ database: 'p', schema: 'raw', name: 'matches' }] },
            { type: 'table', target: { database: 'p', schema: 'rpt', name: 'top_scorers' }, fileName: 'definitions/top_scorers.sqlx', dependencyTargets: [{ database: 'p', schema: 'mart', name: 'player_stats' }] },
            { type: 'view', target: { database: 'p', schema: 'rpt', name: 'league_table' }, fileName: 'definitions/league_table.sqlx', dependencyTargets: [{ database: 'p', schema: 'mart', name: 'player_stats' }] },
            { type: 'incremental', target: { database: 'p', schema: 'rpt', name: 'match_events' }, fileName: 'definitions/match_events.sqlx', dependencyTargets: [{ database: 'p', schema: 'mart', name: 'player_stats' }] },
        ],
        assertions: [{ target: { database: 'p', schema: 'checks', name: 'player_stats_assertions_uniqueKey_0' }, fileName: 'definitions/player_stats.sqlx', dependencyTargets: [{ database: 'p', schema: 'mart', name: 'player_stats' }] }],
        declarations: [{ target: { database: 'p', schema: 'raw', name: 'matches' }, fileName: 'definitions/sources.js' }],
    };
    const index = indexGraph(graph);

    test('finds dependents downstream and dependencies upstream', () => {
        assert.deepStrictEqual(graphNeighbours(index, 'p.mart.player_stats', 'downstream').map((action) => action.fqn), ['p.rpt.top_scorers', 'p.rpt.league_table', 'p.rpt.match_events']);
        assert.deepStrictEqual(graphNeighbours(index, 'p.mart.player_stats', 'upstream').map((action) => action.fqn), ['p.raw.matches']);
        assert.deepStrictEqual(index.get('p.checks.player_stats_assertions_uniqueKey_0'), {
            fqn: 'p.checks.player_stats_assertions_uniqueKey_0',
            type: 'assertion',
            fileName: 'definitions/player_stats.sqlx',
            dependsOn: ['p.mart.player_stats'],
        }, 'indexes assertions, with the file of the table they check, but leaves them out of guessed readers');
    });

    test('links same-name columns, treats script readers and unknown schemas as table-level, and skips the rest', () => {
        const links = guessColumnLinks({ name: 'PLAYER_ID', type: 'STRING' }, [
            { action: index.get('p.rpt.top_scorers')!, columns: [{ name: 'player_id', type: 'STRING' }] },
            { action: index.get('p.rpt.league_table')!, columns: [{ name: 'PLAYER_ID', type: 'INTEGER' }, { name: 'TEAM', type: 'STRING' }] },
            { action: index.get('p.rpt.match_events')!, columns: [{ name: 'PLAYER_ID', type: 'STRING' }] },
            { action: { fqn: 'p.x.unknown', type: 'table', dependsOn: [] }, columns: undefined },
            { action: { fqn: 'p.x.other', type: 'table', dependsOn: [] }, columns: [{ name: 'TEAM', type: 'STRING' }] },
        ], 'downstream');
        assert.deepStrictEqual(links, [
            { table: 'p.rpt.top_scorers', column: 'player_id', dependencyType: 'EXACT_COPY' },
            { table: 'p.rpt.league_table', column: 'PLAYER_ID', dependencyType: 'OTHER' },
            { table: 'p.rpt.match_events', dependencyType: 'TABLE_ONLY' },
            { table: 'p.x.unknown', dependencyType: 'TABLE_ONLY' },
        ]);
    });
});

suite('Column lineage from Data Lineage API links', () => {
    const link = (source: string, sourceField: string | undefined, target: string, targetField: string | undefined, ...types: string[]) => ({
        source: { fullyQualifiedName: `bigquery:${source}`, field: sourceField ? [sourceField] : [] },
        target: { fullyQualifiedName: `bigquery:${target}`, field: targetField ? [targetField] : [] },
        dependencyInfo: types.map((dependencyType) => ({ dependencyType })),
    });

    test('asks for lowercase field names, which is how Dataplex stores them', () => {
        assert.deepStrictEqual(lineageField('PLAYER_ID'), ['player_id']);
        assert.strictEqual(lineageFqn('p.mart.player_stats'), 'bigquery:p.mart.player_stats');
    });

    test('keeps one link per column, preferring a copy, and treats unspecified as a transformation', () => {
        const links = columnLinksFromApi([
            link('p.mart.player_stats', 'player_id', 'p.rpt.top_scorers', 'player_id', 'OTHER'),
            link('p.mart.player_stats', 'player_id', 'p.rpt.top_scorers', 'player_id', 'EXACT_COPY', 'OTHER'),
            link('p.mart.player_stats', 'player_id', 'p.rpt.league_table', 'goals_rank', 'DEPENDENCY_TYPE_UNSPECIFIED'),
            link('p.mart.player_stats', 'player_id', 'p.rpt.no_field', undefined, 'OTHER'),
        ], 'downstream');
        assert.deepStrictEqual(links, [
            { table: 'p.rpt.top_scorers', column: 'player_id', dependencyType: 'EXACT_COPY' },
            { table: 'p.rpt.league_table', column: 'goals_rank', dependencyType: 'OTHER' },
        ]);
    });

    test('keeps readers Dataplex has no column lineage for, and drops tracked readers without a link', async () => {
        const tracked = new Set(['p.rpt.league_table']);
        const untracked = await untrackedReaders(
            ['p.rpt.top_scorers', 'p.rpt.league_table', 'p.rpt.season_summary'],
            new Set(['p.rpt.top_scorers']),
            async (table) => tracked.has(table),
        );
        assert.deepStrictEqual(untracked, ['p.rpt.season_summary']);
    });

    test('reads the source end for upstream links and dedupes table-level ends', () => {
        const upstream = columnLinksFromApi([link('p.raw.matches', 'home_team', 'p.mart.player_stats', 'team', 'OTHER')], 'upstream');
        assert.deepStrictEqual(upstream, [{ table: 'p.raw.matches', column: 'home_team', dependencyType: 'OTHER' }]);
        assert.deepStrictEqual(tablesFromApi([
            link('p.mart.player_stats', undefined, 'p.rpt.top_scorers', undefined),
            link('p.mart.player_stats', undefined, 'p.rpt.top_scorers', undefined),
            link('p.mart.player_stats', undefined, 'p.rpt.match_events', undefined),
        ], 'downstream'), ['p.rpt.top_scorers', 'p.rpt.match_events']);
    });
    test("leaves out tables a script creates and drops while it runs", () => {
        const scriptTemp = 'p._script0f722b7f7e49b6fa.df_5c096741839c6473eb_table_temp';
        const emptyTemp = 'p.daily.df_5c096741839c6473eb_table_empty';
        assert.ok(isTempTable(scriptTemp));
        assert.ok(isTempTable(emptyTemp));
        assert.ok(!isTempTable('p.daily.0100_DPR_ACTUALS'));
        assert.ok(!isTempTable('p.daily.df_metrics'), 'a table only starting with df_ is kept');

        assert.deepStrictEqual(columnLinksFromApi([
            link('p.mart.orders', 'order_id', scriptTemp, 'order_id', 'EXACT_COPY'),
            link('p.mart.orders', 'order_id', 'p.rpt.daily', 'order_id', 'EXACT_COPY'),
        ], 'downstream'), [{ table: 'p.rpt.daily', column: 'order_id', dependencyType: 'EXACT_COPY' }]);
        assert.deepStrictEqual(tablesFromApi([
            link('p.mart.orders', undefined, emptyTemp, undefined),
            link('p.mart.orders', undefined, 'p.rpt.daily', undefined),
        ], 'downstream'), ['p.rpt.daily']);
    });
});

suite('Column lineage call limiter', () => {
    test('runs at most the cap at once, higher priority first, then in order of arrival', async () => {
        const limiter = new Limiter(2);
        const started: string[] = [];
        let running = 0;
        let most = 0;
        const task = (name: string) => async () => {
            started.push(name);
            running++;
            most = Math.max(most, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            running--;
            return name;
        };
        const results = await Promise.all([
            limiter.run(0, task('low-1')),
            limiter.run(0, task('low-2')),
            limiter.run(0, task('low-3')),
            limiter.run(1, task('high-1')),
            limiter.run(0, task('low-4')),
            limiter.run(1, task('high-2')),
        ]);
        assert.strictEqual(most, 2);
        assert.deepStrictEqual(started, ['low-1', 'low-2', 'high-1', 'high-2', 'low-3', 'low-4']);
        assert.deepStrictEqual(results, ['low-1', 'low-2', 'low-3', 'high-1', 'low-4', 'high-2']);
    });

    test('passes a failure to its caller and keeps going', async () => {
        const limiter = new Limiter(1);
        const failed = limiter.run(0, async () => { throw new Error('quota exceeded'); });
        const next = limiter.run(0, async () => 'ok');
        await assert.rejects(failed, /quota exceeded/);
        assert.strictEqual(await next, 'ok');
    });
});

suite('Column lineage graph cards', () => {
    // The focus feeds five columns of one wide table, one of a small table, and an assertion
    const state = addHop(initialTraceState(focus, 'sample'), focusId, 'downstream', [
        ...['a', 'b', 'c', 'd'].map((column) => ({ table: 'p.wide.features', column, dependencyType: 'OTHER' as const })),
        { table: 'p.wide.features', column: 'revenue', dependencyType: 'EXACT_COPY' },
        { table: 'p.rep.dash', column: 'revenue', dependencyType: 'EXACT_COPY' },
        { table: 'p.checks.fct_assertions_uniqueKey_0', column: 'revenue', dependencyType: 'OTHER', assertion: true },
    ]);

    test('makes one card per table per hop, with assertions in one card, and copies first', () => {
        const cards = traceCards(state);
        assert.deepStrictEqual(cards.map((card) => card.id), ['card:0:p.marts.fct', 'card:1:p.wide.features', 'card:1:p.rep.dash', 'card:1:assertions']);
        const wide = cards[1];
        assert.deepStrictEqual(wide.rows.map((row) => row.column), ['revenue', 'a', 'b', 'c', 'd']);
        assert.strictEqual(cardSummary(wide), '5 columns · 1 copy, 4 derived');
        assert.strictEqual(cardSummary(cards[3]), '1 assertion · 1 column · 1 derived');
        assert.deepStrictEqual(cards.map(opensByDefault), [true, false, true, false], 'the focus and small tables open; wide tables and assertions start collapsed');
    });

    test('bundles the edges that meet a collapsed card, and draws one per row between open ones', () => {
        const cards = traceCards(state);
        const open = new Set(cards.filter(opensByDefault).map((card) => card.id));
        const links = cardLinks(state, (id) => open.has(id));
        const wide = links.find((link) => link.target === 'card:1:p.wide.features')!;
        assert.strictEqual(wide.sourceRow, focusId);
        assert.strictEqual(wide.targetRow, undefined);
        assert.strictEqual(wide.edgeIds.length, 5);
        assert.strictEqual(linkLabel(wide), '4 derived · 1 copy');
        assert.strictEqual(linkKind(wide), 'OTHER');
        const dash = links.find((link) => link.target === 'card:1:p.rep.dash')!;
        assert.strictEqual(dash.targetRow, 'p.rep.dash#revenue');
        assert.strictEqual(linkLabel(dash), 'copy');
        assert.strictEqual(linkKind(dash), 'EXACT_COPY');

        open.add('card:1:p.wide.features');
        assert.strictEqual(cardLinks(state, (id) => open.has(id)).filter((link) => link.target === 'card:1:p.wide.features').length, 5, 'one edge per column once expanded');
    });
});
