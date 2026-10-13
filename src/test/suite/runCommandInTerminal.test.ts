import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

    test('the first command in a new terminal is not cancelled by a virtual environment activated in it (#497)', async function () {
        if (process.platform === 'win32') {
            this.skip();
        }
        this.timeout(40 * 1000);
        for (const terminal of vscode.window.terminals.filter((t) => t.name === 'dataform')) {
            terminal.dispose();
        }
        for (let i = 0; i < 50 && vscode.window.terminals.some((t) => t.name === 'dataform'); i++) {
            await new Promise((r) => setTimeout(r, 100));
        }
        // The command leaves a file when it has run to the end: what the shell reports of command lines is not reliable
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xf-497-'));
        const ranFile = path.join(dir, 'ran');
        // As the Python extension does in every new terminal of the user's: the activation, once the shell has started.
        // VS Code sends Ctrl+C before it, and may hold both for seconds, so a wait on our side cannot be relied on
        let shellStarted = false;
        let activated = false;
        const python = vscode.window.onDidChangeTerminalShellIntegration(({ terminal, shellIntegration }) => {
            if (terminal.name !== 'dataform' || shellStarted) {
                return;
            }
            shellStarted = true;
            if ((terminal.creationOptions as vscode.TerminalOptions).hideFromUser) {
                return;
            }
            activated = true;
            shellIntegration.executeCommand('true');
        });
        let terminal: vscode.Terminal | undefined;
        try {
            // Long enough to be still running when a held activation arrives
            terminal = runCommandInTerminal(`sleep 7 && touch '${ranFile}'`);
            for (let i = 0; i < 300 && !fs.existsSync(ranFile); i++) {
                await new Promise((r) => setTimeout(r, 100));
            }
            if (!shellStarted) {
                // The shell has no shell integration here, so no activation could be imitated
                this.skip();
            }
            assert.strictEqual(activated, false, 'a virtual environment was activated in the terminal');
            assert.ok(fs.existsSync(ranFile), 'the command was cancelled');
            assert.ok(vscode.window.terminals.includes(terminal), 'the terminal is not among the terminals of the window');
        } finally {
            python.dispose();
            terminal?.dispose();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
