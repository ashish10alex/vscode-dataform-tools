import { Target } from "./types";
import { loadLineageClient } from './lazySdk';

export async function getLiniageMetadata(targetToSearch: Target, location:string) {
    const projectId = targetToSearch.database;
    const datasetId = targetToSearch.schema;
    const tableId = targetToSearch.name;

    const client = new (await loadLineageClient())(); // TODO: This gets created everytime this func is called. Can we use same client for longer ?

    const request = {
        parent: `projects/${projectId}/locations/${location}`,
        source: {
            fullyQualifiedName: `bigquery:${projectId}.${datasetId}.${tableId}`
        },
        // NOTE: target seems to get upstream. We might or might not need this
        //target: {
        //    fullyQualifiedName: `bigquery:${projectId}.${datasetId}.${tableId}`
        //},
    };

    try {
        const [response] = await client.searchLinks(request);
        const prefix = "bigquery:";
        const dependencies = response.map((link:any) => link.target.fullyQualifiedName.slice(prefix.length));
        return {
            dependencies: dependencies,
            error: undefined,
        };

    } catch (error:any) {
        return {
            dependencies: undefined,
            error: error.details,
        };
    }
}
