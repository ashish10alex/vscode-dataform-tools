import * as assert from 'assert';
import { suite, test } from 'mocha';
import { cliOutputSaysRunning, runStage, runStageLines, stripAnsi, timeToStart } from '../../shared/runStages';

const T = 1_000_000;

suite('runStages', () => {
    test('a CLI run is in the stage after the last one it reached', () => {
        assert.strictEqual(runStage({ invokedAt: T }, 'cli'), 'preparing');
        assert.strictEqual(runStage({ invokedAt: T, preparedAt: T + 1 }, 'cli'), 'preparing');
        assert.strictEqual(runStage({ invokedAt: T, sentAt: T + 2 }, 'cli'), 'starting');
        assert.strictEqual(runStage({ invokedAt: T, sentAt: T + 2, startedAt: T + 3 }, 'cli'), 'compiling');
        assert.strictEqual(runStage({ invokedAt: T, sentAt: T + 2, startedAt: T + 3, compiledAt: T + 4 }, 'cli'), 'starting jobs');
        assert.strictEqual(runStage({ invokedAt: T, sentAt: T + 2, firstJobAt: T + 5 }, 'cli'), undefined);
    });

    test('a run through the API is prepared, then submitted', () => {
        assert.strictEqual(runStage({ invokedAt: T }, 'api'), 'preparing');
        assert.strictEqual(runStage({ invokedAt: T, preparedAt: T + 1 }, 'api'), 'submitting');
        assert.strictEqual(runStage({ invokedAt: T, preparedAt: T + 1, sentAt: T + 2 }, 'api'), undefined);
    });

    test('the checklist has the stages done with their time, the one the run is in, and those to come', () => {
        const lines = runStageLines({ invokedAt: T, sentAt: T + 1200, startedAt: T + 6000 }, 'cli', T + 9000);
        assert.deepStrictEqual(lines.map((line) => [line.label, line.state, line.ms]), [
            ['Preparing', 'done', 1200],
            ['Starting terminal', 'done', 4800],
            ['Compiling', 'current', 3000],
            ['Starting jobs', 'todo', undefined],
        ]);
    });

    test('a run that has its first job has every stage done', () => {
        const stages = { invokedAt: T, sentAt: T + 1200, startedAt: T + 6000, compiledAt: T + 12000, firstJobAt: T + 12400 };
        assert.deepStrictEqual(runStageLines(stages, 'cli', T + 99999).map((line) => [line.short, line.state, line.ms]), [
            ['prep', 'done', 1200], ['terminal', 'done', 4800], ['compile', 'done', 6000], ['jobs', 'done', 400],
        ]);
        assert.strictEqual(timeToStart(stages, 'cli'), 12400);
        assert.strictEqual(timeToStart({ invokedAt: T, sentAt: T + 5 }, 'cli'), undefined);
    });

    test('a stage nothing told of is left out, and its time goes to the one before', () => {
        // The CLI's "Running..." was not seen: compiling lasts until the first job
        const lines = runStageLines({ invokedAt: T, sentAt: T + 1000, startedAt: T + 2000, firstJobAt: T + 9000 }, 'cli', T + 9999);
        assert.deepStrictEqual(lines.map((line) => [line.short, line.ms]), [['prep', 1000], ['terminal', 1000], ['compile', 7000]]);
    });

    test('on a terminal that tells nothing, starting and compiling are one stage', () => {
        const waiting = runStageLines({ invokedAt: T, sentAt: T + 1200, silentShell: true }, 'cli', T + 10200);
        assert.deepStrictEqual(waiting.map((line) => [line.label, line.state, line.ms]), [
            ['Preparing', 'done', 1200],
            ['Starting and compiling in the terminal', 'current', 9000],
        ]);
        assert.strictEqual(runStage({ invokedAt: T, sentAt: T + 1200, silentShell: true }, 'cli'), 'starting');
    });

    test('a run that ended before any job failed in the stage it was in', () => {
        const lines = runStageLines({ invokedAt: T, sentAt: T + 1000, startedAt: T + 2000 }, 'cli', T + 9000, true);
        assert.deepStrictEqual(lines.map((line) => [line.label, line.state]), [['Preparing', 'done'], ['Starting terminal', 'done'], ['Compiling', 'failed']]);
    });

    test('the checklist of a run through the API', () => {
        assert.deepStrictEqual(runStageLines({ invokedAt: T }, 'api', T + 500).map((line) => [line.label, line.state]), [['Preparing', 'current'], ['Submitting to Dataform', 'todo']]);
        const submitted = { invokedAt: T, preparedAt: T + 1000, sentAt: T + 3000 };
        assert.deepStrictEqual(runStageLines(submitted, 'api', T + 9000).map((line) => [line.short, line.ms]), [['prep', 1000], ['submit', 2000]]);
        assert.strictEqual(timeToStart(submitted, 'api'), 3000);
    });

    test("the CLI's output says when it has compiled and is running, through its colours", () => {
        const compiling = '\u001b[93mNote: --timeout only bounds project compilation.\u001b[0m\r\nCompiling...\r\n\r\n';
        assert.strictEqual(cliOutputSaysRunning(compiling), false);
        assert.strictEqual(cliOutputSaysRunning(`${compiling}\u001b[32mCompiled successfully.\r\n\u001b[0m\r\nRunning...\r\n\r\n`), true);
        assert.strictEqual(cliOutputSaysRunning(`${compiling}\u001b[32mCompiled successfully.\n\u001b[0m\n\u001b[0mRunning...\u001b[0m\n`), true);
        // A dry run runs nothing, and half a line is not the line yet
        assert.strictEqual(cliOutputSaysRunning('Dry running (no changes to the warehouse will be applied)...\n'), false);
        assert.strictEqual(cliOutputSaysRunning('Compiled successfully.\n\nRunn'), false);
        assert.strictEqual(stripAnsi('\u001b]633;C\u0007\u001b[1;32mok\u001b[0m'), 'ok');
    });
});
