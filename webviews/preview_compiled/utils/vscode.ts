import { WebviewApi } from "vscode-webview";

declare function acquireVsCodeApi(): WebviewApi<unknown>;

class VSCodeAPIWrapper {
  private readonly vsCodeApi: WebviewApi<unknown> | undefined;

  constructor() {
    // Check if the acquireVsCodeApi function exists in the current environment
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  /**
   * Post a message to the extension
   * @param message The message to send
   */
  public postMessage(message: unknown) {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      console.log("Mock postMessage:", message);
    }
  }

  /**
   * Get the current state of the webview
   */
  public getState(): unknown {
    if (this.vsCodeApi) {
      return this.vsCodeApi.getState();
    }
    return {};
  }

  /**
   * Set the state of the webview
   * @param state The new state
   */
  public setState(state: unknown) {
    if (this.vsCodeApi) {
      this.vsCodeApi.setState(state);
    } else {
        console.log("Mock setState:", state);
    }
  }
}

// Export a singleton instance of the wrapper
export const vscode = new VSCodeAPIWrapper();
