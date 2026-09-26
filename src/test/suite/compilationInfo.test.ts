import * as assert from 'assert';
import { suite, test } from 'mocha';
import { compilationInfoParts, compilationInfoTooltip, customCliLabel, formatRelativeTime } from '../../../webviews/preview_compiled/utils/compilationInfoFormat';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const minutesAgo = (m: number) => NOW - m * 60_000;

suite('compilationInfoFormat.formatRelativeTime', () => {
    test('formats recent, minute, hour and day ages', () => {
        assert.strictEqual(formatRelativeTime(NOW - 10_000, NOW), 'just now');
        assert.strictEqual(formatRelativeTime(minutesAgo(12), NOW), '12 min ago');
        assert.strictEqual(formatRelativeTime(minutesAgo(180), NOW), '3 h ago');
        assert.strictEqual(formatRelativeTime(minutesAgo(60 * 48), NOW), '2 d ago');
    });

    test('never reports a negative age for timestamps slightly in the future', () => {
        assert.strictEqual(formatRelativeTime(NOW + 5_000, NOW), 'just now');
    });
});

suite('compilationInfoFormat.compilationInfoParts', () => {
    test('CLI compile shows backend, duration and age', () => {
        assert.deepStrictEqual(
            compilationInfoParts({ backend: 'cli', compiledAt: NOW, durationMs: 3044, fromCache: false }, NOW),
            ['CLI', '3.04s', 'just now'],
        );
    });

    test('fresh API compile shows the short sha and duration', () => {
        assert.deepStrictEqual(
            compilationInfoParts({ backend: 'api', compiledAt: NOW, durationMs: 6066, fromCache: false, sha: '87be5b33b17419c8' }, NOW),
            ['API @ 87be5b3', '6.07s', 'just now'],
        );
    });

    test('cached API compile says cached and shows its age and release config', () => {
        assert.deepStrictEqual(
            compilationInfoParts({ backend: 'api', compiledAt: minutesAgo(12), fromCache: true, sha: '87be5b33b17419c8', releaseConfig: 'production' }, NOW),
            ['API @ 87be5b3', 'production', 'cached', '12 min ago'],
        );
    });

    test('tooltip explains staleness and the cache', () => {
        const tooltip = compilationInfoTooltip({
            backend: 'api', compiledAt: NOW, fromCache: true, sha: '87be5b3', stale: true, staleReason: 'Local HEAD differs from the compiled commit.',
        });
        assert.ok(tooltip.includes('pushed commit 87be5b3'));
        assert.ok(tooltip.includes('Served from the cache'));
        assert.ok(tooltip.includes('Local HEAD differs from the compiled commit.'));
    });
});

suite('compilationInfoFormat.customCliLabel', () => {
    test('points out a CLI configured through dataformExecutablePath', () => {
        const info = { backend: 'cli' as const, compiledAt: NOW, fromCache: false, cliPath: '/opt/dataform-dev/dataform', cliSource: 'setting' as const };
        assert.strictEqual(customCliLabel(info), '/opt/dataform-dev/dataform (dataformExecutablePath)');
        assert.ok(compilationInfoTooltip(info).includes('Dataform CLI: /opt/dataform-dev/dataform (from the vscode-dataform-tools.dataformExecutablePath setting)'));
    });

    test('stays quiet for the CLI found on PATH and for API compiles', () => {
        assert.strictEqual(customCliLabel({ backend: 'cli', compiledAt: NOW, fromCache: false, cliPath: '/usr/local/bin/dataform', cliSource: 'path' }), undefined);
        assert.strictEqual(customCliLabel({ backend: 'api', compiledAt: NOW, fromCache: false, sha: 'abc' }), undefined);
    });
});
