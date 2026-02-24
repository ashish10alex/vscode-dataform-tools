import type { VSCodeMessage } from './types';

//@ts-ignore
import { WebviewApi } from "vscode-webview";

declare function acquireVsCodeApi(): WebviewApi<unknown>;

class VSCodeAPIWrapper {
    private readonly vsCodeApi: any;

    constructor() {
        if (typeof acquireVsCodeApi === 'function') {
            this.vsCodeApi = acquireVsCodeApi();
        }
    }

    public postMessage(message: VSCodeMessage) {
        if (this.vsCodeApi) {
            this.vsCodeApi.postMessage(message);
        } else {
            console.log('Would post message to VS Code:', message);
        }
    }

    public getState() {
        if (this.vsCodeApi) {
            return this.vsCodeApi.getState();
        } else {
            return undefined;
        }
    }

    public setState(state: any) {
        if (this.vsCodeApi) {
            this.vsCodeApi.setState(state);
        } else {
            console.log('Would set VS Code state:', state);
        }
    }
}

export const vscode = new VSCodeAPIWrapper();
