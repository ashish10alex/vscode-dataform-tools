import * as vscode from 'vscode';

class Logger {
    private outputChannel: vscode.OutputChannel;
    private enabled: boolean;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Dataform Tools');
        this.enabled = false;
    }

    public initialize() {
        this.enabled = vscode.workspace.getConfiguration('vscode-dataform-tools').get('enableLogging') || false;
        if (this.enabled) {
            this.info('Logging initialized');
        }
    }

    public info(message: string) {
        if (this.enabled) {
            const timeStamp = new Date().toISOString();
            this.outputChannel.appendLine(`[${timeStamp}] INFO: ${message}`);
        }
    }

    public error(message: string, error?: any) {
        if (this.enabled) {
            const timeStamp = new Date().toISOString();
            this.outputChannel.appendLine(`[${timeStamp}] ERROR: ${message}`);
            if (error) {
                this.outputChannel.appendLine(JSON.stringify(error, null, 2));
            }
        }
    }

    public debug(message: string) {
        if (this.enabled) {
            const timeStamp = new Date().toISOString();
            this.outputChannel.appendLine(`[${timeStamp}] DEBUG: ${message}`);
        }
    }

    public show() {
        this.outputChannel.show();
    }

    public dispose() {
        this.outputChannel.dispose();
    }
}

export const logger = new Logger(); 