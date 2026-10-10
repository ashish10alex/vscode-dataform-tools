import { DependancyModelMetadata } from "./types";
import { compiledJson } from './project';
import { GraphEdge, buildDependencyGraph } from "./shared/buildDependencyGraph";
import { getRelativePath, getVSCodeDocument, getWorkspaceFolder, runCompilation } from "./utils";
import { resolveDataformOptions } from './project/dataformOptions';

export async function generateDependancyTreeMetadata(): Promise<{
    dependancyTreeMetadata: DependancyModelMetadata[];
    initialEdgesStatic: GraphEdge[];
    datasetColorMap: Map<string, string>;
    currentActiveEditorIdx: string;
} | undefined> {
    let compiled = compiledJson();
    if (!compiled) {
        const workspaceFolder = await getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        compiled = (await runCompilation(workspaceFolder, resolveDataformOptions(workspaceFolder))).dataformCompiledJson; // Takes ~1100ms
    }

    if (!compiled) {
        return;
    }

    const document = getVSCodeDocument() || activeDocumentObj;
    const currentActiveEditorFilePath = document?.uri?.fsPath;
    const currentActiveEditorRelativePath = currentActiveEditorFilePath
        ? getRelativePath(currentActiveEditorFilePath)
        : "";

    const result = buildDependencyGraph(compiled, {
        focusIdentifier: currentActiveEditorRelativePath || undefined,
    });

    return {
        dependancyTreeMetadata: result.nodes,
        initialEdgesStatic: result.edges,
        datasetColorMap: result.datasetColorMap,
        currentActiveEditorIdx: result.focusNodeId ?? "0",
    };
}
