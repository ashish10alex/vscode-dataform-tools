

export function getSourcesCommand(workspaceFolder: string): string {
    return `dataform compile ${workspaceFolder} --json | dj table-ops declarations-and-targets`
}

export function getTagsCommand(workspaceFolder: string): string {
    return `dataform compile ${workspaceFolder} --json | dj tag-ops --unique`
}

export function getDryRunCommand(workspaceFolder: string, filename: string): string {
    return `dataform compile ${workspaceFolder} --json \
		| dj table-ops cost --compact=true --include-assertions=true -t ${filename}`
}

export function compiledQueryCommand(workspaceFolder: string, filename: string): string {
    return `dataform compile ${workspaceFolder} --json \
		| dj table-ops query -t ${filename}`
}
