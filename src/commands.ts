
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

export function getRunTagsWtOptsCommand(workspaceFolder: string, tag: string, dataformCompilationTimeoutVal:string, includeDependencies:boolean, includeDependents:boolean, fullRefresh:boolean): string {
    let runTagsCommand = `dataform run ${workspaceFolder} --timeout=${dataformCompilationTimeoutVal}`;
    runTagsCommand += ` --tags=${tag}`;
    if (includeDependencies) {
        runTagsCommand += ` --include-deps`;
    }
    if (includeDependents) {
        runTagsCommand += ` --include-dependents`;
    }
    if (fullRefresh) {
        runTagsCommand += ` --full-refresh`;
    }
    return runTagsCommand;
}
