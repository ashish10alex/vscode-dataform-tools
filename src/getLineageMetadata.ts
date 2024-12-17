import { Target } from "./types";
const {LineageClient} = require('@google-cloud/lineage').v1;

export async function getLiniageMetadata(targetToSearch: Target) {
    const projectId = targetToSearch.database;
    const datasetId = targetToSearch.schema;
    const tableId = targetToSearch.name;
    const location = "eu"; //TODO: make this user selectable

    const client = new LineageClient(); // TODO: This gets created everytime this func is called. Can we use same client for longer ?

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
