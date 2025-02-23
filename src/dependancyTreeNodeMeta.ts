import { Assertion, Declarations, DependancyModelMetadata, Operation, Table } from "./types";
import { getWorkspaceFolder, runCompilation } from "./utils";

function populateDependancyTree(type: string, structs: Table[] | Operation[] | Assertion[] | Declarations[], dependancyTreeMetadata: DependancyModelMetadata[], initialEdgesStatic: any[], modelIdx: number, modelNameToIdx: Map<string, number>) {

    // const initialEdgesStatic = [
    //     { id: 'e1-2', source: '1', target: '2' }, 
    //     { id: 'e1-3', source: '2', target: '3' }, 
    // ]

    if (type === "tables" || type === "assertions") {
        for (let i = 0; i < structs.length; i++) {
            let targetIdx = modelIdx;

            const fullTableName = `${structs[i].target.database}.${structs[i].target.schema}.${structs[i].target.name}`;
            const dependecies = structs[i].dependencyTargets;

            // we need to ensure that the model name is unique in the dependancy tree
            if(modelNameToIdx.has(fullTableName)) {
                targetIdx = modelNameToIdx.get(fullTableName)!;
            } else {
                modelNameToIdx.set(fullTableName, modelIdx);
                modelIdx++;
            }

            let modelDependencies: any[] = [];
            if(dependecies) {
                for(let j = 0; j < dependecies.length; j++) {
                    const fullTableName = `${dependecies[j].database}.${dependecies[j].schema}.${dependecies[j].name}`;
                    if(!modelNameToIdx.has(fullTableName)) {
                        modelDependencies.push(fullTableName);
                        modelNameToIdx.set(fullTableName, modelIdx);
                        modelIdx++;
                    } else {
                        modelDependencies.push(fullTableName);
                    }
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
                    datasetColor: "grey",
                    fileName: structs[i].fileName,
                }
            });

            if(modelDependencies.length > 0) {
                modelDependencies.forEach((dependency) => {
                    const sourceIdx = modelNameToIdx.get(dependency) || 0;
                    initialEdgesStatic.push({ id: `e${sourceIdx}-${targetIdx}`, source: String(sourceIdx), target: String(targetIdx)});
                });
            }
        }
    }
    return { dependancyTreeMetadata, initialEdgesStatic, modelNameToIdx };
}


export async function generateDependancyTreeMetadata(): Promise<any> {
    let dependancyTreeMetadata: DependancyModelMetadata[] = [];
    // let schemaDict = {}; // used to keep track of unique schema names ( gcp dataset name ) already seen in the compiled json declarations
    // let schemaIdx = 0;   // used to assign a unique index to each unique schema name for color coding dataset in the web panel
    let modelIdx = 0;    // used to assign a unique index to each model for color coding model in the web panel
    let modelNameToIdx = new Map<string, number>();
    let initialEdgesStatic: any[] = [];

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

    if (!CACHED_COMPILED_DATAFORM_JSON) {
        return;
    }
    let tables = CACHED_COMPILED_DATAFORM_JSON.tables;
    // let operations = CACHED_COMPILED_DATAFORM_JSON.operations;
    let assertions = CACHED_COMPILED_DATAFORM_JSON.assertions;
    // let declarations = CACHED_COMPILED_DATAFORM_JSON.declarations;

    if (tables) {
       const output = populateDependancyTree("tables", tables, dependancyTreeMetadata, initialEdgesStatic, modelIdx, modelNameToIdx);
       dependancyTreeMetadata = output.dependancyTreeMetadata;
       initialEdgesStatic = output.initialEdgesStatic;
       modelNameToIdx = output.modelNameToIdx;
    }

    if (assertions) {
        const output = populateDependancyTree("assertions", assertions, dependancyTreeMetadata, initialEdgesStatic, modelIdx, modelNameToIdx);
        dependancyTreeMetadata = output.dependancyTreeMetadata;
        initialEdgesStatic = output.initialEdgesStatic;
        modelNameToIdx = output.modelNameToIdx;
    }
    return { dependancyTreeMetadata, initialEdgesStatic };


    // if (operations) {
    //     const { dependancyTreeMetadata, initialEdgesStatic, modelNameToIdx } = populateDependancyTree("operations", operations, dependancyTreeMetadata, modelIdx, modelNameToIdx);
    // }

    // if (declarations) {
    //     output = populateDependancyTree("declarations", declarations, output ? output["dependancyTreeMetadata"] : dependancyTreeMetadata, schemaDict, output ? output["schemaIdx"] : schemaIdx, modelIdx);
    // }
    // return { "dependancyTreeMetadata": output ? output["dependancyTreeMetadata"] : dependancyTreeMetadata, "declarationsLegendMetadata": output ? output["declarationsLegendMetadata"] : [] };
}