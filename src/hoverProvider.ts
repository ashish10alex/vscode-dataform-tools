import * as vscode from "vscode";
import {
  getWorkspaceFolder,
  runCompilation,
  getTextByLineRange,
} from "./utils";

// the comment-parser library does not have types in it so we have ignore the typescript error
// @ts-ignore
import {parse as commentParser} from 'comment-parser';

import { Assertion, DataformCompiledJson, Operation, Table } from "./types";
import * as fs from "fs";
import * as path from "path";
import { getMetadataForSqlxFileBlocks} from "./sqlxFileParser";
import { createSourceFile, forEachChild, getJSDocTags, isClassDeclaration, isFunctionDeclaration, isIdentifier, isVariableDeclaration, Node, ScriptTarget } from "typescript";


const getUrlToNavigateToTableInBigQuery = (gcpProjectId:string, datasetId:string, tableName:string) => {
  return `https://console.cloud.google.com/bigquery?project=${gcpProjectId}&ws=!1m5!1m4!4m3!1s${gcpProjectId}!2s${datasetId}!3s${tableName}`;
};

const getMarkdownTableIdWtLink = (fullTableIdStruct:{database:string, schema:string, name:string})  => {
      let {database, schema, name } = fullTableIdStruct;
      const fullTableId = `${database}.${schema}.${name}`;
      const linkToTable = `${getUrlToNavigateToTableInBigQuery(database, schema, name)}`;
      return `[${fullTableId}](${linkToTable})`;
};

let parseJsDocBlock = (jsDocBlock: string, nodeName:string) => {
    let out = commentParser(jsDocBlock);
    let descriptionOnTopOfJsDoc = out[0].description || "";
    let functionSignature = `function ${nodeName}(`;
    let hoverContent = "";
    let gotReturnType = false;

    out.forEach((doc:any) => {
        doc.tags.forEach((tag:any) => {
            const name = tag.name;
            const type = tag.type;
            let optional = tag.optional;
            if (optional === true){
              optional = " `[optional]`";
            }else {
              optional = "";
            }
        
            const description = tag.description;

            if(tag.tag === "returns"){
              functionSignature+= `): ${type}`;
              hoverContent +=`Returns: ${type} \n\n`;
              gotReturnType = true;
            } else {
              functionSignature+= `${name}: ${type}, `;
              hoverContent +=`${name}:  \`${type}\`  ${optional}: ${description} \n\n`;
            }
        });
    });
    if(gotReturnType){
      functionSignature = `\`\`\`javascript\n var ${functionSignature}\n\`\`\``;
    }else{
      functionSignature = functionSignature.replace(/,\s*$/, ''); // remove comma and any trailing white space
      functionSignature += ")";
      functionSignature = `\`\`\`javascript\n var ${functionSignature}\n\`\`\``;
    }
    return {functionSignature: functionSignature, hoverContent:hoverContent, descriptionOnTopOfJsDoc: descriptionOnTopOfJsDoc};
};

function getHoverOfVariableInJsFileOrBlock(code: string, searchTerm:string): vscode.Hover|undefined {
    const sourceFile = createSourceFile('temp.js', code, ScriptTarget.Latest, true);

    function visit(node: Node):any {
        let nodeType = "";
        if (isFunctionDeclaration(node)) {
            nodeType = "FunctionDeclaration";
        } else if (isVariableDeclaration(node)) {
            nodeType = "VariableDeclaration";
        } else if (isClassDeclaration(node)) {
            nodeType = "ClassDeclaration";
        } else {
            nodeType = "Unknown";
        }

        if (isFunctionDeclaration(node) || isVariableDeclaration(node) || isClassDeclaration(node)) {
            const name = node.name && isIdentifier(node.name) ? node.name.text : 'anonymous';
            // TODO: use this later for better go to definition
            // const startPosition = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            // const endPosition = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

            if(name === searchTerm){
                let hoverContent = `\`\`\`javascript\n var ${node.getText()}\n\`\`\``;
                if (nodeType === "VariableDeclaration"){
                    return new vscode.Hover(new vscode.MarkdownString(hoverContent));
                }

                const jsDocTags = getJSDocTags(node);

                if (jsDocTags.length > 0) {
                    // the comment-parser library does not have types in it so we have ignore the typescript error
                    // @ts-ignore
                    const jsDocFullText = jsDocTags[0].parent.parent.body.parent.getFullText();
                    const nodeName = node.name?.getText() || "anonymous";
                    let {functionSignature, hoverContent, descriptionOnTopOfJsDoc}  = parseJsDocBlock(jsDocFullText, nodeName);
                    hoverContent = functionSignature + "\n\n" + descriptionOnTopOfJsDoc + '\n\n' + hoverContent;
                    return new vscode.Hover(new vscode.MarkdownString(hoverContent));
                } else {
                    return new vscode.Hover(new vscode.MarkdownString(hoverContent));
                }
            }
        }
        return forEachChild(node, visit);
   }
   return visit(sourceFile);
}


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
  let hover;
  if(jsBlock.exists){
      const jsBlockCode = await getTextByLineRange(document.uri, jsBlock.startLine, jsBlock.endLine);
      if(jsBlockCode){
        hover = getHoverOfVariableInJsFileOrBlock(jsBlockCode, variableName);
      }
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
              const jsBlockCode = await getTextByLineRange(filePathUri, startLine, endLine);
              if(jsBlockCode){
                return getHoverOfVariableInJsFileOrBlock(jsBlockCode, variableName);
              }
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

      const jsBlockCode = await getTextByLineRange(filePathUri, startLine, endLine);
      if(jsBlockCode){
        return getHoverOfVariableInJsFileOrBlock(jsBlockCode, variableName);
      }
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
  } else {
    const regex = /\$\{([^}]+)\}/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
        // console.log(`Found reference: ${match[0]}, Content: ${match[1]}`);
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
            const jsBlockCode = await getTextByLineRange(document.uri, jsBlock.startLine, jsBlock.endLine);
            if(jsBlockCode){
            return getHoverOfVariableInJsFileOrBlock(jsBlockCode, searchTerm);
            }
          }
      }
    }

    return undefined; // If not matches are found then we will not show anything on hover

    }
  }
}