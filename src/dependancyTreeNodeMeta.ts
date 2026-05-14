import { DependancyModelMetadata } from "./types";
import { GraphEdge, buildDependencyGraph } from "./shared/buildDependencyGraph";
import { getRelativePath, getVSCodeDocument, getWorkspaceFolder, runCompilation } from "./utils";

export async function generateDependancyTreeMetadata(): Promise<{
    dependancyTreeMetadata: DependancyModelMetadata[];
    initialEdgesStatic: GraphEdge[];
    datasetColorMap: Map<string, string>;
    currentActiveEditorIdx: string;
} | undefined> {
    if (!CACHED_COMPILED_DATAFORM_JSON) {
        const workspaceFolder = await getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        const { dataformCompiledJson } = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    }

    if (!CACHED_COMPILED_DATAFORM_JSON) {
        return;
    }

    const document = getVSCodeDocument() || activeDocumentObj;
    const currentActiveEditorFilePath = document?.uri?.fsPath;
    const currentActiveEditorRelativePath = currentActiveEditorFilePath
        ? getRelativePath(currentActiveEditorFilePath)
        : "";

    const result = buildDependencyGraph(CACHED_COMPILED_DATAFORM_JSON, {
        focusIdentifier: currentActiveEditorRelativePath || undefined,
    });

    return {
        dependancyTreeMetadata: result.nodes,
        initialEdgesStatic: result.edges,
        datasetColorMap: result.datasetColorMap,
        currentActiveEditorIdx: result.focusNodeId ?? "0",
    };
}
