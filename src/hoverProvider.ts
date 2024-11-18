import * as vscode from "vscode";
import {
  getWorkspaceFolder,
  runCompilation,
  getPostionOfSourceDeclaration,
  getPostionOfVariableInJsFileOrBlock,
  getHoverOfVariableInJsFileOrBlock
} from "./utils";
import { Assertion, DataformCompiledJson, Operation, Table } from "./types";
import * as fs from "fs";
import * as path from "path";
import { getMetadataForSqlxFileBlocks} from "./sqlxFileParser";


const getUrlToNavigateToTableInBigQuery = (gcpProjectId:string, datasetId:string, tableName:string) => {
  return `https://console.cloud.google.com/bigquery?project=${gcpProjectId}&ws=!1m5!1m4!4m3!1s${gcpProjectId}!2s${datasetId}!3s${tableName}`;
};

const getMarkdownTableIdWtLink = (fullTableIdStruct:{database:string, schema:string, name:string})  => {
      let {database, schema, name } = fullTableIdStruct;
      const fullTableId = `${database}.${schema}.${name}`;
      const linkToTable = `${getUrlToNavigateToTableInBigQuery(database, schema, name)}`;
      return `[${fullTableId}](${linkToTable})`;
};


function getTableInformationFromRef(
  searchTerm: string,
  struct: Table[]
): vscode.Hover | undefined {
  let hoverMeta: vscode.Hover | undefined;
  for (let i = 0; i < struct.length; i++) {
    let targetName = struct[i].target.name;
    if (searchTerm === targetName) {

      const markdownTableIdWtLink = getMarkdownTableIdWtLink(struct[i].target);
      const tableMetadata = `\nType: ${struct[i].type}` +
                      (struct[i].bigquery?.partitionBy ? `\nPartition: ${struct[i].bigquery.partitionBy}` : ``) +
                      (struct[i].dependencyTargets
                        ? `\nDependencies:\n${struct[i].dependencyTargets
                            .map(dep => `- ${dep.database}.${dep.schema}.${dep.name}`)
                            .join('\n')}`
                        : ``);
      const hoverMarkdownString = new vscode.MarkdownString(
        markdownTableIdWtLink + "\n ```bash" + tableMetadata + "\n```"
      );

      hoverMarkdownString.isTrusted = true; // Allows command links
      hoverMarkdownString.supportThemeIcons = true; // Allows ThemeIcons

      hoverMeta = new vscode.Hover(hoverMarkdownString);
    }
  }
  return hoverMeta;
}

function getFullTableNameFromRef(
  searchTerm: string,
  struct: Operation[] | Assertion[]
): vscode.Hover | undefined {
  let hoverMeta: vscode.Hover | undefined;
  for (let i = 0; i < struct.length; i++) {
    let targetName = struct[i].target.name;
    if (searchTerm === targetName) {

      const markdownTableIdWtLink = getMarkdownTableIdWtLink(struct[i].target);
      const hoverData = new vscode.MarkdownString(markdownTableIdWtLink);
      return new vscode.Hover(hoverData);
    }
  }
  return hoverMeta;
}
interface ImportedModule {
  module: string;
  path: string;
}

export function getImportedModules(
    document: vscode.TextDocument,
): ImportedModule[] {
    const requireRegex = /(const|var|let)\s+(\w+)\s*=\s*require\(["'](.+?)["']\)/g;
    const importedModules: ImportedModule[] = [];
    const text = document.getText();
    let match: RegExpExecArray | null;

    while ((match = requireRegex.exec(text)) !== null) {
        importedModules.push({ module: match[2], path: match[3] });
    }

    return importedModules;
}

async function findModuleVarDefinition(
  document: vscode.TextDocument,
  workspaceFolder: string,
  jsFileName:string,
  variableName:string,
  startLine:number,
  endLine:number,
) {
  const sqlxFileMetadata = getMetadataForSqlxFileBlocks(document);
  const jsBlock = sqlxFileMetadata.jsBlock;
  if(jsBlock.exists){
      let hover = await getHoverOfVariableInJsFileOrBlock(document.uri, variableName, jsBlock.startLine, jsBlock.endLine);
      if (hover) {
          return hover;
      }  
    }


  const includesPath = path.join(workspaceFolder, 'includes');
  let jsFileWtSameNameUri;
  try {
      const fileNames = fs.readdirSync(includesPath);
      for (const fileName of fileNames) {
          if(fileName === jsFileName + ".js"){
              const filePath = path.join(includesPath, fileName);
              const filePathUri = vscode.Uri.file(filePath);
              jsFileWtSameNameUri =  filePathUri;
              return await getHoverOfVariableInJsFileOrBlock(filePathUri, variableName, startLine, endLine);

              };
          }
  } catch (error) {
      console.error(`Error reading includes directory: ${error}`);
  }

  // If not found in includes directory, check if it is imported
  const importedModules = getImportedModules(document);
  const importedModule = importedModules.find(module => module.module === jsFileName);

  if (importedModule) {
      const filePath = path.join(workspaceFolder, importedModule.path);
      const filePathUri = vscode.Uri.file(filePath);
      return await getHoverOfVariableInJsFileOrBlock(filePathUri, variableName, startLine, endLine);
  }

  return undefined;
}


export class DataformHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ) {
    let searchTerm = document.getText(
      document.getWordRangeAtPosition(position)
    );
    const line = document.lineAt(position.line).text;

    // early return
    if (line.indexOf("${") === -1) {
      return undefined;
    }
    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder){return;}

    if (line.indexOf("${ref") !== -1) {
    let hoverMeta: vscode.Hover | undefined;

    let dataformCompiledJson: DataformCompiledJson | undefined;
    if (!CACHED_COMPILED_DATAFORM_JSON) {
      vscode.window.showWarningMessage(
        "Compile the Dataform project once for faster go to definition"
      );
      let {dataformCompiledJson, errors} = await runCompilation(workspaceFolder); // Takes ~1100ms
      dataformCompiledJson = dataformCompiledJson;
    } else {
      dataformCompiledJson = CACHED_COMPILED_DATAFORM_JSON;
    }

    let declarations = dataformCompiledJson?.declarations;
    let tables = dataformCompiledJson?.tables;
    let operations = dataformCompiledJson?.operations;
    let assertions = dataformCompiledJson?.assertions;
    let tablePrefix = dataformCompiledJson?.projectConfig?.tablePrefix;

    if (declarations) {
      for (let i = 0; i < declarations.length; i++) {
        let declarationName = declarations[i].target.name;
        if (searchTerm === declarationName) {
          const markdownTableIdWtLink = getMarkdownTableIdWtLink(declarations[i].target);
          const hoverData = new vscode.MarkdownString(markdownTableIdWtLink);
          return new vscode.Hover(hoverData);

        }
      }
      if (tablePrefix) {
        searchTerm = tablePrefix + "_" + searchTerm;
      }

      if (tables) {
        hoverMeta = getTableInformationFromRef(searchTerm, tables);
      }
      if (hoverMeta) {
        return hoverMeta;
      }

      if (operations) {
        hoverMeta = getFullTableNameFromRef(searchTerm, operations);
      }
      if (hoverMeta) {
        return hoverMeta;
      }

      if (assertions) {
        return getFullTableNameFromRef(searchTerm, assertions);
      }
    }
  } else {
      const regex = /\$\{([^}]+)\}/g;
      let match;
      while ((match = regex.exec(line)) !== null) {
          console.log(`Found reference: ${match[0]}, Content: ${match[1]}`);
          const content =  (match[1]);
          if (content.includes(".")){
            const [jsFileName, variableOrFunctionSignature] = content.split('.'); 
            if(variableOrFunctionSignature.includes(searchTerm)){
                return findModuleVarDefinition(document, workspaceFolder, jsFileName, searchTerm, 0, -1);
            }
          } else if (content.includes('.') === false && content.trim() !== ''){
            const sqlxFileMetadata = getMetadataForSqlxFileBlocks(document);
            const jsBlock = sqlxFileMetadata.jsBlock;
            if(jsBlock.exists === true){
              return await getHoverOfVariableInJsFileOrBlock(document, searchTerm, jsBlock.startLine, jsBlock.endLine);
            }
        }
      }
      return undefined; // If not matches are found then we will not show anything on hover
  }
}
}