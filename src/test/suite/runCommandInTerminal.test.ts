import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import { runCommandInTerminal } from '../../utils/vscodeUi';

globalThis.isRunningOnWindows = process.platform === 'win32';

/** A terminal that records what is typed into it, as a TUI running there would read it. */
function recordingTerminal(name: string): { terminal: vscode.Terminal; typed: string[] } {
    const typed: string[] = [];
    const writeEmitter = new vscode.EventEmitter<string>();
    const pty: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        open: () => {},
        close: () => {},
        handleInput: (data) => { typed.push(data); },
    };
    return { terminal: vscode.window.createTerminal({ name, pty }), typed };
}

async function waitForActive(terminal: vscode.Terminal): Promise<void> {
    terminal.show();
    for (let i = 0; i < 50 && vscode.window.activeTerminal !== terminal; i++) {
        await new Promise((r) => setTimeout(r, 100));
    }
    assert.strictEqual(vscode.window.activeTerminal, terminal, 'the other terminal did not become active');
}

suite('runCommandInTerminal', () => {
    test('runs commands in its own terminal, never in the active one', async () => {
        const other = recordingTerminal('xf');
        try {
            await waitForActive(other.terminal);

            const first = runCommandInTerminal('dataform run --actions a');
            const second = runCommandInTerminal('dataform run --actions b');
            await new Promise((r) => setTimeout(r, 500));

            assert.deepStrictEqual(other.typed, [], 'a command was typed into the active terminal');
            assert.notStrictEqual(first, other.terminal);
            assert.strictEqual(first.name, 'dataform');
            assert.strictEqual(second, first, 'the dataform terminal was not reused');
            assert.strictEqual(vscode.window.terminals.filter((t) => t.name === 'dataform').length, 1);
        } finally {
            other.terminal.dispose();
        }
    });

    test('makes a new terminal when its own was closed', async () => {
        const first = runCommandInTerminal('dataform compile');
        first.dispose();
        for (let i = 0; i < 50 && vscode.window.terminals.includes(first); i++) {
            await new Promise((r) => setTimeout(r, 100));
        }
        const second = runCommandInTerminal('dataform compile');
        try {
            assert.notStrictEqual(second, first);
            assert.strictEqual(second.name, 'dataform');
        } finally {
            second.dispose();
        }
    });
});
