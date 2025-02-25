// @ts-ignore
let vscodeApi: any;

export function getVsCodeApi() {
    if (!vscodeApi) {
        // @ts-ignore
        vscodeApi = acquireVsCodeApi();
    }
    return vscodeApi;
} 