import { Assertion, Declarations, DependancyModelMetadata, Operation, Table } from "./types";
import { getRelativePath, getVSCodeDocument, getWorkspaceFolder, runCompilation } from "./utils";

const datasetColors = [
    "#3B82F6", // Blue
    "#EF4444", // Soft Red
    "#10B981", // Emerald
    "#F59E0B", // Amber
    "#8B5CF6", // Violet
    "#EC4899", // Pink
    "#06B6D4", // Cyan
    "#F97316", // Orange
    "#6366F1", // Indigo
    "#14B8A6", // Teal
    "#84CC16", // Lime
    "#F43F5E", // Rose
    "#64748B", // Slate
    "#D946EF", // Fuchsia
    "#0EA5E9", // Sky Blue
    "#22C55E", // Green
    "#EAB308", // Yellow
    "#A855F7", // Purple
    "#FB923C", // Light Orange
    "#38BDF8"  // Light Sky Blue
];

function populateDependancyTree(type: string, structs: Table[] | Operation[] | Assertion[] | Declarations[], dependancyTreeMetadata: DependancyModelMetadata[], initialEdgesStatic: any[], modelIdx: number, modelNameToIdx: Map<string, number>, datasetColorMap: Map<string, string>, currentActiveEditorRelativePath: string, currentActiveEditorIdx: string) {
    let isExternalSource = false;

    if(type === "declarations") {
        isExternalSource = true;
    }

    for (let i = 0; i < structs.length; i++) {
        let targetIdx = modelIdx;

        const fullTableName = `${structs[i].target.database}.${structs[i].target.schema}.${structs[i].target.name}`;
        const dependecies = structs[i].dependencyTargets;
        const dataset = structs[i].target.schema;

        // I only want to set the color for the dataset if it is a dataset in a declaration
        if(type === "declarations") {
            if(!datasetColorMap.has(dataset)) {
                datasetColorMap.set(dataset, datasetColors[i % datasetColors.length]);
            }
        }

        // we need to ensure that the model name is unique in the dependancy tree
        if(modelNameToIdx.has(fullTableName)) {
            targetIdx = modelNameToIdx.get(fullTableName)!;
        } else {
            modelNameToIdx.set(fullTableName, modelIdx);
            modelIdx++;
        }

        if(currentActiveEditorRelativePath !== "" && currentActiveEditorRelativePath === structs[i].fileName && currentActiveEditorIdx === "0") {
            currentActiveEditorIdx = String(targetIdx);
        }

        if(dependecies) {
            for(let j = 0; j < dependecies.length; j++) {
                const fullTableName = `${dependecies[j].database}.${dependecies[j].schema}.${dependecies[j].name}`;
                if(!modelNameToIdx.has(fullTableName)) {
                    modelNameToIdx.set(fullTableName, modelIdx);
                    modelIdx++;
                }
                const sourceIdx = modelNameToIdx.get(fullTableName)!;
                initialEdgesStatic.push({ id: `e${sourceIdx}-${targetIdx}`, source: String(sourceIdx), target: String(targetIdx), tags: structs[i].tags});
            }
        }
        dependancyTreeMetadata.push({
            id: String(targetIdx),
            type: "tableNode",
            data: {
                modelName: structs[i].target.name,
                datasetId: structs[i].target.schema,
                projectId: structs[i].target.database,
                type: (structs[i] as Table | Assertion | Operation ).type || type,
                tags: structs[i].tags,
                datasetColor: datasetColorMap.get(dataset) || "grey",
                fileName: structs[i].fileName,
                isExternalSource: isExternalSource,
                fullTableName: fullTableName
            }
        });
    }
    return { dependancyTreeMetadata, initialEdgesStatic, modelNameToIdx, datasetColorMap, currentActiveEditorIdx };
}


export async function generateDependancyTreeMetadata(): Promise<any> {
    let dependancyTreeMetadata: DependancyModelMetadata[] = [];
    let modelIdx = 0;    // used to assign a unique index to each model for color coding model in the web panel
    let modelNameToIdx = new Map<string, number>();
    let initialEdgesStatic: any[] = [];
    let datasetColorMap = new Map<string, string>();
    let currentActiveEditorIdx = "0";


    if (!CACHED_COMPILED_DATAFORM_JSON) {
        let workspaceFolder = await getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        let {dataformCompiledJson} = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    }

    let document = getVSCodeDocument() || activeDocumentObj;
    let currentActiveEditorFilePath = document?.uri?.fsPath;
    let currentActiveEditorRelativePath = "";
    if (currentActiveEditorFilePath) {
        currentActiveEditorRelativePath = getRelativePath(currentActiveEditorFilePath);
    }

    if (!CACHED_COMPILED_DATAFORM_JSON) {
        return;
    }
    let tables = CACHED_COMPILED_DATAFORM_JSON.tables;
    let operations = CACHED_COMPILED_DATAFORM_JSON.operations;
    let assertions = CACHED_COMPILED_DATAFORM_JSON.assertions;
    let declarations = CACHED_COMPILED_DATAFORM_JSON.declarations;

    if (tables) {
        const output = populateDependancyTree("tables", tables, dependancyTreeMetadata, initialEdgesStatic, modelIdx, modelNameToIdx, datasetColorMap, currentActiveEditorRelativePath, currentActiveEditorIdx);
        dependancyTreeMetadata = output.dependancyTreeMetadata;
        initialEdgesStatic = output.initialEdgesStatic;
        modelNameToIdx = output.modelNameToIdx;
        modelIdx = modelNameToIdx.size; // Update modelIdx to the current size of the map
        datasetColorMap = output.datasetColorMap;
        currentActiveEditorIdx = output.currentActiveEditorIdx;
    }

    if (assertions) {
        const output = populateDependancyTree("assertions", assertions, dependancyTreeMetadata, initialEdgesStatic, modelIdx, modelNameToIdx, datasetColorMap, currentActiveEditorRelativePath, currentActiveEditorIdx);
        dependancyTreeMetadata = output.dependancyTreeMetadata;
        initialEdgesStatic = output.initialEdgesStatic;
        modelNameToIdx = output.modelNameToIdx;
        modelIdx = modelNameToIdx.size; // Update modelIdx to the current size of the map
        datasetColorMap = output.datasetColorMap;
        currentActiveEditorIdx = output.currentActiveEditorIdx;
    }

    if (operations) {
        const output = populateDependancyTree("operations", operations, dependancyTreeMetadata, initialEdgesStatic, modelIdx, modelNameToIdx, datasetColorMap, currentActiveEditorRelativePath, currentActiveEditorIdx);
        dependancyTreeMetadata = output.dependancyTreeMetadata;
        initialEdgesStatic = output.initialEdgesStatic;
        modelNameToIdx = output.modelNameToIdx;
        modelIdx = modelNameToIdx.size; // Update modelIdx to the current size of the map
        datasetColorMap = output.datasetColorMap;
        currentActiveEditorIdx = output.currentActiveEditorIdx;
    }

    if (declarations) {
        const output = populateDependancyTree("declarations", declarations, dependancyTreeMetadata, initialEdgesStatic, modelIdx, modelNameToIdx, datasetColorMap, currentActiveEditorRelativePath, currentActiveEditorIdx);
        dependancyTreeMetadata = output.dependancyTreeMetadata;
        initialEdgesStatic = output.initialEdgesStatic;
        modelNameToIdx = output.modelNameToIdx;
        datasetColorMap = output.datasetColorMap;
        currentActiveEditorIdx = output.currentActiveEditorIdx;
    }
    return { dependancyTreeMetadata, initialEdgesStatic, datasetColorMap, currentActiveEditorIdx};
}