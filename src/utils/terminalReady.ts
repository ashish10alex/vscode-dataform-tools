import * as vscode from 'vscode';

/*
 * A command sent to a terminal at once after it was made can be cancelled: the Python extension activates the
 * workspace's virtual environment in every new terminal, by sending Ctrl+C and then `source .../activate`, and when
 * that arrives after our command has started, the Ctrl+C stops it (#497). So the first command waits until the shell
 * has started and what other extensions run in a new terminal has finished.
 *
 * The wait alone is not enough. VS Code holds a command given to `shellIntegration.executeCommand` before the first
 * prompt until the shell integration timeout has passed (5s by default), and tells nothing of it meanwhile: the
 * activation then arrives seconds after the shell has started. So the terminals are also made with `hideFromUser`,
 * which the Python extensions take as a terminal that is not the user's, and do not activate. Our commands need no
 * virtual environment: they name their program by its full path.
 */

/** The window events a terminal is waited on with. Tests pass their own */
export interface TerminalEvents {
    onDidChangeTerminalShellIntegration?: vscode.Event<{ terminal: vscode.Terminal }>;
    onDidStartTerminalShellExecution?: vscode.Event<{ terminal: vscode.Terminal; execution: unknown }>;
    onDidEndTerminalShellExecution?: vscode.Event<{ terminal: vscode.Terminal; execution: unknown }>;
    onDidCloseTerminal: vscode.Event<vscode.Terminal>;
}

/** Milliseconds */
export interface TerminalWaits {
    /** For the shell to start, as shell integration tells. A shell without it is waited on this long, and no more */
    shellIntegration: number;
    /** After the shell has started, for another extension to start a command in it */
    quiet: number;
    /** For such a command to end */
    execution: number;
}

/** VS Code's own wait for shell integration, when the user has set one; else as long as VS Code waits by default */
function shellIntegrationWait(): number {
    const setting = vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').get<number>('timeout', -1);
    return setting > 0 ? setting : 5000;
}

export function defaultTerminalWaits(): TerminalWaits {
    return { shellIntegration: shellIntegrationWait(), quiet: 1000, execution: 10000 };
}

/**
 * Resolves when a new terminal can take a command: its shell has started, and the commands other extensions started
 * in it, such as the activation of a virtual environment, have ended. Resolves too when the terminal is closed, and
 * after the waits, whichever comes first. Never rejects.
 */
export function whenTerminalReady(
    terminal: vscode.Terminal,
    events: TerminalEvents = vscode.window,
    waits: TerminalWaits = defaultTerminalWaits(),
): Promise<void> {
    return new Promise((resolve) => {
        const disposables: vscode.Disposable[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        /** Commands started in the terminal and not yet ended */
        const running = new Set<unknown>();
        let settled = false;
        const done = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            disposables.forEach((disposable) => disposable.dispose());
            resolve();
        };
        const wait = (ms: number, then: () => void) => {
            clearTimeout(timer);
            timer = setTimeout(then, ms);
        };
        const listen = <T extends { terminal: vscode.Terminal }>(event: vscode.Event<T> | undefined, listener: (e: T) => void) => {
            if (event) {
                disposables.push(event((e) => e.terminal === terminal && listener(e)));
            }
        };
        let started = false;
        const shellStarted = () => {
            if (started) {
                return;
            }
            started = true;
            // Whatever else is sent to a new terminal comes right after its shell has started
            listen(events.onDidStartTerminalShellExecution, ({ execution }) => {
                running.add(execution);
                wait(waits.execution, done);
            });
            listen(events.onDidEndTerminalShellExecution, ({ execution }) => {
                running.delete(execution);
                if (running.size === 0) {
                    wait(waits.quiet, done);
                }
            });
            wait(waits.quiet, done);
        };

        disposables.push(events.onDidCloseTerminal((closed) => closed === terminal && done()));
        // Older VS Code has no shell integration API, and some shells (cmd, or with the setting off) none at all
        const integrated = events.onDidChangeTerminalShellIntegration !== undefined
            && vscode.workspace.getConfiguration('terminal.integrated.shellIntegration').get<boolean>('enabled', true);
        if (!integrated) {
            wait(waits.shellIntegration, done);
            return;
        }
        listen(events.onDidChangeTerminalShellIntegration, shellStarted);
        if ((terminal as { shellIntegration?: unknown }).shellIntegration) {
            shellStarted();
        } else {
            wait(waits.shellIntegration, done);
        }
    });
}

/** When each terminal can take a command. A terminal that is not here is ready */
const ready = new WeakMap<vscode.Terminal, Promise<void>>();

/**
 * Makes a terminal, whose commands wait until it is ready. No virtual environment is activated in it. It is not
 * shown until `show()` is called on it. On Windows its shell is cmd.
 */
export function createTerminalWhenReady(options: vscode.TerminalOptions): vscode.Terminal {
    // On Windows the shell is cmd, whatever the user's own is: a command line is written for the one shell. Sent
    // through `cmd /C` to the user's shell it was read twice, by PowerShell or Git Bash first, each in its own way
    const isCmd = process.platform === 'win32';
    const terminal = vscode.window.createTerminal({ ...options, ...(isCmd ? { shellPath: process.env.ComSpec || 'cmd.exe' } : {}), hideFromUser: true });
    // cmd has no shell integration to wait for, and starts at once
    const waits = defaultTerminalWaits();
    ready.set(terminal, whenTerminalReady(terminal, vscode.window, isCmd ? { ...waits, shellIntegration: waits.quiet } : waits));
    return terminal;
}

/**
 * Sends a command to a terminal once it is ready; at once to one that was not made by
 * {@link createTerminalWhenReady}. Commands are sent in the order they were given. A terminal closed meanwhile is
 * sent nothing. Resolves when the command has been sent, or dropped; never rejects.
 */
export function sendTextWhenReady(terminal: vscode.Terminal, text: string): Promise<void> {
    const sent = (ready.get(terminal) ?? Promise.resolve()).then(() => {
        if (terminal.exitStatus === undefined) {
            try {
                terminal.sendText(text);
            } catch {
                // Disposed meanwhile
            }
        }
    });
    ready.set(terminal, sent);
    return sent;
}
