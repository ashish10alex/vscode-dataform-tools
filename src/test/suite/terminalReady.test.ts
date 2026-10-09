import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import { TerminalWaits, whenTerminalReady } from '../../utils/terminalReady';

const waits: TerminalWaits = { shellIntegration: 400, quiet: 100, execution: 1000 };

/** The window events of a terminal, fired by the test */
function fakeWindow() {
    const shellIntegration = new vscode.EventEmitter<{ terminal: vscode.Terminal }>();
    const start = new vscode.EventEmitter<{ terminal: vscode.Terminal; execution: unknown }>();
    const end = new vscode.EventEmitter<{ terminal: vscode.Terminal; execution: unknown }>();
    const close = new vscode.EventEmitter<vscode.Terminal>();
    return {
        events: {
            onDidChangeTerminalShellIntegration: shellIntegration.event,
            onDidStartTerminalShellExecution: start.event,
            onDidEndTerminalShellExecution: end.event,
            onDidCloseTerminal: close.event,
        },
        shellIntegration, start, end, close,
    };
}

/** Milliseconds from now until the promise resolves */
async function timed(promise: Promise<void>): Promise<number> {
    const startedAt = Date.now();
    await promise;
    return Date.now() - startedAt;
}

const after = (ms: number, then: () => void) => setTimeout(then, ms);

suite('whenTerminalReady', () => {
    test('waits for the shell to start, then for a quiet moment', async () => {
        const window = fakeWindow();
        const terminal = {} as vscode.Terminal;
        after(150, () => window.shellIntegration.fire({ terminal }));
        const ms = await timed(whenTerminalReady(terminal, window.events, waits));
        assert.ok(ms >= 240 && ms < 400, `${ms}ms`);
    });

    test('waits for a command another extension started, such as the activation of a virtual environment', async () => {
        const window = fakeWindow();
        const terminal = {} as vscode.Terminal;
        const activation = {};
        after(50, () => window.shellIntegration.fire({ terminal }));
        after(100, () => window.start.fire({ terminal, execution: activation }));
        // Events of other terminals are no matter
        after(200, () => window.end.fire({ terminal: {} as vscode.Terminal, execution: activation }));
        after(500, () => window.end.fire({ terminal, execution: activation }));
        const ms = await timed(whenTerminalReady(terminal, window.events, waits));
        assert.ok(ms >= 590 && ms < 800, `${ms}ms`);
    });

    test('does not wait for the shell when it has already started', async () => {
        const window = fakeWindow();
        const terminal = { shellIntegration: {} } as unknown as vscode.Terminal;
        const ms = await timed(whenTerminalReady(terminal, window.events, waits));
        assert.ok(ms >= 90 && ms < 300, `${ms}ms`);
    });

    test('gives up on a shell without shell integration, and on a command that does not end', async () => {
        const window = fakeWindow();
        const terminal = {} as vscode.Terminal;
        let ms = await timed(whenTerminalReady(terminal, window.events, waits));
        assert.ok(ms >= 390 && ms < 600, `${ms}ms`);

        after(50, () => window.shellIntegration.fire({ terminal }));
        after(100, () => window.start.fire({ terminal, execution: {} }));
        ms = await timed(whenTerminalReady(terminal, window.events, waits));
        assert.ok(ms >= 1090 && ms < 1400, `${ms}ms`);
    });

    test('without the shell integration API, as in older VS Code, waits the time a shell takes to start', async () => {
        const { onDidCloseTerminal } = fakeWindow().events;
        const ms = await timed(whenTerminalReady({} as vscode.Terminal, { onDidCloseTerminal }, waits));
        assert.ok(ms >= 390 && ms < 600, `${ms}ms`);
    });

    test('stops waiting when the terminal is closed', async () => {
        const window = fakeWindow();
        const terminal = {} as vscode.Terminal;
        after(50, () => window.close.fire(terminal));
        const ms = await timed(whenTerminalReady(terminal, window.events, waits));
        assert.ok(ms < 200, `${ms}ms`);
    });
});
