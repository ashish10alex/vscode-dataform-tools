import * as vscode from "vscode";
import { logger } from "../logger";

export class SnoozeManager {
    private static instance: SnoozeManager;
    private snoozeEndTime: number | null = null;
    private snoozeTimer: NodeJS.Timeout | null = null;
    private statusBarInterval: NodeJS.Timeout | null = null;
    private statusBarItem: vscode.StatusBarItem | null = null;
    private dirtyEditsDuringSnooze: boolean = false;
    private onSnoozeEndedCallback: (() => Promise<void> | void) | null = null;
    private postMessageToWebview: ((message: any) => void) | null = null;
    private isWebviewVisible: (() => boolean) | null = null;

    private constructor() {}

    public static getInstance(): SnoozeManager {
        if (!SnoozeManager.instance) {
            SnoozeManager.instance = new SnoozeManager();
        }
        return SnoozeManager.instance;
    }

    public registerWebviewHandlers(
        postMessage: (message: any) => void,
        isWebviewVisible: () => boolean
    ) {
        this.postMessageToWebview = postMessage;
        this.isWebviewVisible = isWebviewVisible;
    }

    public setOnSnoozeEndedCallback(callback: () => Promise<void> | void) {
        this.onSnoozeEndedCallback = callback;
    }

    public isSnoozeActive(): boolean {
        return this.snoozeEndTime !== null && this.snoozeEndTime > Date.now();
    }

    public getSnoozeEndTime(): number | null {
        return this.isSnoozeActive() ? this.snoozeEndTime : null;
    }

    public markDirtyDuringSnooze() {
        if (this.isSnoozeActive()) {
            this.dirtyEditsDuringSnooze = true;
            logger.debug("Change during snooze; marked dirty for compilation on snooze end");
        }
    }

    public hasDirtyEditsDuringSnooze(): boolean {
        return this.dirtyEditsDuringSnooze;
    }

    public startSnooze(context?: vscode.ExtensionContext, minutes?: number) {
        const configMinutes = vscode.workspace.getConfiguration("vscode-dataform-tools").get<number>("compilationSnoozeMinutes") || 5;
        const durationMinutes = minutes !== undefined && minutes > 0 ? minutes : configMinutes;

        this.clearTimers();

        const durationMs = durationMinutes * 60 * 1000;
        // Don't reset dirtyEditsDuringSnooze here: re-snoozing while active must keep pending edits.
        // stopSnooze already clears it when a snooze ends.
        this.snoozeEndTime = Date.now() + durationMs;
        logger.info(`Snooze compilation started for ${durationMinutes} minutes (until ${new Date(this.snoozeEndTime).toLocaleTimeString()})`);

        // Status bar item setup
        if (!this.statusBarItem) {
            this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
            this.statusBarItem.command = "vscode-dataform-tools.stopSnoozeCompilation";
            this.statusBarItem.tooltip = "Dataform compilation snoozed. Click to stop snooze.";
            if (context) {
                context.subscriptions.push(this.statusBarItem);
            }
        }
        this.updateStatusBar();
        this.statusBarItem.show();

        this.statusBarInterval = setInterval(() => {
            if (!this.isSnoozeActive()) {
                this.stopSnooze(true);
            } else {
                this.updateStatusBar();
            }
        }, 1000);

        this.snoozeTimer = setTimeout(() => {
            this.stopSnooze(true);
        }, durationMs);

        // Notify webview or show notification
        const webviewVisible = this.isWebviewVisible ? this.isWebviewVisible() : false;
        if (this.postMessageToWebview) {
            this.postMessageToWebview({ snoozeEndTime: this.snoozeEndTime });
        }

        if (!webviewVisible) {
            vscode.window.showInformationMessage(
                `Dataform compilation snoozed for ${durationMinutes} minutes.`,
                "Stop Snooze"
            ).then(selection => {
                if (selection === "Stop Snooze") {
                    this.stopSnooze(false);
                }
            });
        }
    }

    public async stopSnooze(expired: boolean = false) {
        const wasActive = this.snoozeEndTime !== null;
        if (!wasActive) {
            return;
        }

        const hadDirty = this.dirtyEditsDuringSnooze;
        logger.info(`Snooze compilation stopped (expired=${expired}, hadDirtyEdits=${hadDirty})`);

        this.clearTimers();
        this.snoozeEndTime = null;
        this.dirtyEditsDuringSnooze = false;

        if (this.statusBarItem) {
            this.statusBarItem.hide();
        }

        if (this.postMessageToWebview) {
            this.postMessageToWebview({ snoozeEndTime: null });
        }

        if (expired) {
            vscode.window.showInformationMessage("Dataform compilation snooze has ended.");
        }

        if (hadDirty && this.onSnoozeEndedCallback) {
            logger.info("Triggering compilation for edits accumulated during snooze");
            await this.onSnoozeEndedCallback();
        }
    }

    private updateStatusBar() {
        if (!this.statusBarItem || !this.snoozeEndTime) {
            return;
        }
        const remainingMs = Math.max(0, this.snoozeEndTime - Date.now());
        const totalSec = Math.ceil(remainingMs / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        this.statusBarItem.text = `$(clock) Snoozed (${m}:${s.toString().padStart(2, "0")})`;
    }

    private clearTimers() {
        if (this.snoozeTimer) {
            clearTimeout(this.snoozeTimer);
            this.snoozeTimer = null;
        }
        if (this.statusBarInterval) {
            clearInterval(this.statusBarInterval);
            this.statusBarInterval = null;
        }
    }

    public dispose() {
        this.clearTimers();
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
            this.statusBarItem = null;
        }
    }
}

export const snoozeManager = SnoozeManager.getInstance();
