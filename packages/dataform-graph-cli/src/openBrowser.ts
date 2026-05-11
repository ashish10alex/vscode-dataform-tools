import { spawn } from "node:child_process";

/**
 * Best-effort cross-platform browser launch. Fire-and-forget — errors are
 * swallowed because the URL is always printed to stdout as a fallback.
 */
export function openInBrowser(url: string): void {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === "darwin") {
        cmd = "open";
        args = [url];
    } else if (platform === "win32") {
        // Empty quoted title argument prevents `start` from treating the URL as one.
        cmd = "cmd";
        args = ["/c", "start", "", url];
    } else {
        cmd = "xdg-open";
        args = [url];
    }

    try {
        const child = spawn(cmd, args, { stdio: "ignore", detached: true });
        child.on("error", () => {
            /* user can copy URL from stdout */
        });
        child.unref();
    } catch {
        /* ignore */
    }
}
