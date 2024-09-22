

export function getRunTagsCommand(workspaceFolder: string, tag: string, dataformCompilationTimeoutVal:string): string {
    return `dataform run ${workspaceFolder} --timeout=${dataformCompilationTimeoutVal} --tags=${tag}`;
}

export function getRunMultipleTagsCommand(workspaceFolder: string, tags: string, dataformCompilationTimeoutVal:string, includDependencies:boolean, includeDownstreamDependents:boolean, fullRefresh:boolean ): string {
    let runMultiTagsCommand = `dataform run ${workspaceFolder} --timeout=${dataformCompilationTimeoutVal}`;
    for (let tag of tags) {
        runMultiTagsCommand += ` --tags=${tag}`;
    }
    if (includDependencies) {
        runMultiTagsCommand += ` --include-deps`;
    }
    if (includeDownstreamDependents) {
        runMultiTagsCommand += ` --include-dependents`;
    }
    if (fullRefresh) {
        runMultiTagsCommand += ` --full-refresh`;
    }
    return runMultiTagsCommand;
}

export function getRunTagsWtDepsCommand(workspaceFolder: string, tag: string, dataformCompilationTimeoutVal:string ): string {
    return `dataform run ${workspaceFolder} --timeout=${dataformCompilationTimeoutVal} --tags=${tag} --include-deps`;
}

export function getRunTagsWtDownstreamDepsCommand(workspaceFolder: string, tag: string, dataformCompilationTimeoutVal:string): string {
    return `dataform run ${workspaceFolder} --timeout=${dataformCompilationTimeoutVal} --tags=${tag} --include-dependents`;
}
