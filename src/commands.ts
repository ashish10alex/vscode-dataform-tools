

export function getRunTagsCommand(workspaceFolder: string, tag: string): string {
    return `dataform run ${workspaceFolder} --tags=${tag}`;
}

export function getRunTagsWtDepsCommand(workspaceFolder: string, tag: string): string {
    return `dataform run ${workspaceFolder} --tags=${tag} --include-deps`;
}

export function getRunTagsWtDownstreamDepsCommand(workspaceFolder: string, tag: string): string {
    return `dataform run ${workspaceFolder} --tags=${tag} --include-dependents`;
}

export function getFormatDataformFileCommand(cliPath:string, relativeFilePath: string): string {
    return `${cliPath} format ${relativeFilePath}`;
}
