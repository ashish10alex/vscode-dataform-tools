import { Assertion, Declarations, DependancyModelMetadata, Operation, Table } from "./types";
import { getRelativePath, getWorkspaceFolder, runCompilation } from "./utils";
import * as vscode from 'vscode';

const datasetColors = [
    "#FF0000", "#00FF00", "#0000FF", "#FF00FF", "#FFFF00", "#00FFFF",
    "#FF8000", "#80FF00", "#00FF80", "#0080FF", "#8000FF", "#FF0080",
    "#A0522D", "#006400", "#483D8B", "#800000", "#008080", "#4B0082",
    "#FFB6C1", "#98FB98", "#87CEEB", "#DDA0DD", "#F0E68C", "#E0FFFF",
    "#FF4500", "#32CD32", "#1E90FF", "#FF1493", "#FFD700", "#20B2AA",
    "#8B4513", "#228B22", "#4169E1", "#8B008B", "#DAA520", "#008B8B",
    "#FF6347", "#90EE90", "#6495ED", "#BA55D3"
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
                initialEdgesStatic.push({ id: `e${sourceIdx}-${targetIdx}`, source: String(sourceIdx), target: String(targetIdx)});
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
        let workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        let {dataformCompiledJson} = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    }

    let document = activeDocumentObj || vscode.window.activeTextEditor?.document;
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