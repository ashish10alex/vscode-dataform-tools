// The Google Cloud SDKs and js-beautify are loaded on first use instead of at activation: evaluating
// them up front added ~250 ms before activate() could run, whether or not a feature needed them.
// Import their types with `import type`, and their values through these loaders.

export async function loadDataformTools() {
    return (await import('@ashishalex/dataform-tools')).DataformTools;
}

export async function loadBigQuery() {
    return (await import('@google-cloud/bigquery')).BigQuery;
}

export async function loadProjectsClient() {
    return (await import('@google-cloud/resource-manager')).ProjectsClient;
}

export async function loadLineageClient() {
    return (await import('@google-cloud/lineage')).v1.LineageClient;
}

export async function loadGoogleAuth() {
    return (await import('google-auth-library')).GoogleAuth;
}

export async function loadBeautify() {
    return (await import('js-beautify')).default;
}
