/**
 * Tiny stderr spinner with no dependencies.
 *
 * Returns a `stop` function that clears the spinner line and, when called with
 * `{ success: true }`, prints a brief "✓ done in 1.2s" line in its place.
 *
 * When stderr is not a TTY, falls back to a single "Compiling..." line on
 * start and "done in 1.2s" on stop — no escape codes that would clutter logs.
 */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

export interface StopOptions {
    /** Print a success line in place of the spinner. */
    success?: boolean;
    /** Optional override for the success line; defaults to `message`. */
    successMessage?: string;
}

export function startSpinner(message: string): (opts?: StopOptions) => void {
    const isTty = !!process.stderr.isTTY;
    const startedAt = Date.now();

    if (!isTty) {
        process.stderr.write(`${message}\n`);
        let stopped = false;
        return (opts) => {
            if (stopped) {return;}
            stopped = true;
            if (opts?.success) {
                const ms = Date.now() - startedAt;
                process.stderr.write(`done in ${(ms / 1000).toFixed(1)}s\n`);
            }
        };
    }

    let i = 0;
    // Hide the cursor while the spinner is active for a cleaner look.
    process.stderr.write("\x1b[?25l");
    const render = () => {
        process.stderr.write(`\r${FRAMES[i]} ${message}`);
        i = (i + 1) % FRAMES.length;
    };
    render();
    const handle = setInterval(render, FRAME_INTERVAL_MS);

    let stopped = false;
    return (opts) => {
        if (stopped) {return;}
        stopped = true;
        clearInterval(handle);
        // Clear the spinner line and restore the cursor.
        process.stderr.write("\r\x1b[2K\x1b[?25h");
        if (opts?.success) {
            const ms = Date.now() - startedAt;
            const line = opts.successMessage ?? message;
            process.stderr.write(`✓ ${line} (${(ms / 1000).toFixed(1)}s)\n`);
        }
    };
}
