

export function getRunTagsCommand(workspaceFolder: string, tag: string, dataformCompilationTimeoutVal:string): string {
    return `dataform run ${workspaceFolder} --timeout=${dataformCompilationTimeoutVal} --tags=${tag}`;
}

export function getRunTagsWtDepsCommand(workspaceFolder: string, tag: string, dataformCompilationTimeoutVal:string ): string {
    return `dataform run ${workspaceFolder} --timeout=${dataformCompilationTimeoutVal} --tags=${tag} --include-deps`;
}

export function getRunTagsWtDownstreamDepsCommand(workspaceFolder: string, tag: string, dataformCompilationTimeoutVal:string): string {
    return `dataform run ${workspaceFolder} --timeout=${dataformCompilationTimeoutVal} --tags=${tag} --include-dependents`;
}

export function getFormatDataformFileCommand(cliPath:string, relativeFilePath: string): string {
    return `${cliPath} format ${relativeFilePath}`;
}
