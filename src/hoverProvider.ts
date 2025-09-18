import * as vscode from "vscode";
const { BigQuery } = require('@google-cloud/bigquery');
import {
  getWorkspaceFolder,
  getTextByLineRange,
  getOrCompileDataformJson,
} from "./utils";

// the comment-parser library does not have types in it so we have ignore the typescript error
// @ts-ignore
import {parse as commentParser} from 'comment-parser';

import { Assertion, ColumnMetadata, Operation, Table, Target } from "./types";
import * as fs from "fs";
import * as path from "path";
import { getMetadataForSqlxFileBlocks} from "./sqlxFileParser";
import { createSourceFile, forEachChild, getJSDocTags, isClassDeclaration, isFunctionDeclaration, isIdentifier, isVariableDeclaration, Node, ScriptTarget } from "typescript";
import { sqlKeywordsToExcludeFromHoverDefinition } from "./constants";


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

async function getTableSchemaAsMarkdown(projectId: string, datasetId:string, tableId:string) {
  try {

    const serviceAccountJsonPath  = vscode.workspace.getConfiguration('vscode-dataform-tools').get('serviceAccountJsonPath');
    let options = {projectId};
    if(serviceAccountJsonPath){
    // @ts-ignore 
        options = {... options , keyFilename: serviceAccountJsonPath}
    }
    const bigqueryClient = new BigQuery(options);

    if(bigqueryClient){

    const table = bigqueryClient.dataset(datasetId).table(tableId);

    const [metadata] = await table.getMetadata();
    const schema = metadata.schema;

     if (schema && schema.fields) {
      schema.fields.sort((a:any, b:any) => a.name.localeCompare(b.name));
      schema.fields.forEach((field:any) => {
        field.name = field.name || "";
        field.type = field.type || "";
        field.description = field.description || "";
        Object.keys(field).forEach(key => {
          if (!["name", "type", "description"].includes(key)) {
            delete field[key];
          }
        });
      });
}

    return import('tablemark').then(({ default: tablemark }) => {
      const output = tablemark(schema.fields);
      return output;
    });
    }
  } catch (err) {
    console.error('Error:', err);
  }
  return ``;
}

async function getTableInformationFromRef(
  searchTerm: string,
  struct: Table[]
): Promise<vscode.Hover | undefined> {
  let hoverMeta: vscode.Hover | undefined;
  for (let i = 0; i < struct.length; i++) {
    let targetName = struct[i].target.name;
    if (searchTerm === targetName) {

      const markdownTableIdWtLink = getMarkdownTableIdWtLink(struct[i].target);
      const tableType = `**Type:** ${struct[i].type}`;
      const partition = struct[i].bigquery?.partitionBy 
        ? `**Partition:** \`${struct[i].bigquery.partitionBy}\`` 
        : '';
      const tableSchema = await getTableSchemaAsMarkdown(struct[i].target.database, struct[i].target.schema, struct[i].target.name);

      const hoverMarkdownString = new vscode.MarkdownString();
      hoverMarkdownString.appendMarkdown(`#### ${markdownTableIdWtLink}\n\n`);
      hoverMarkdownString.appendMarkdown(`${tableType}\n\n`);
      if (partition) {
        hoverMarkdownString.appendMarkdown(`${partition}\n\n`);
      }
      if (tableSchema) {
        hoverMarkdownString.appendMarkdown(`${tableSchema}\n`);
      }

      hoverMarkdownString.isTrusted = true; // Allows command links
      hoverMarkdownString.supportThemeIcons = true; // Allows ThemeIcons

     hoverMeta = new vscode.Hover(hoverMarkdownString);
    }
  }
  return hoverMeta;
}

async function getFullTableNameFromRef(
  searchTerm: string,
  struct: Operation[] | Assertion[]
): Promise<vscode.Hover | undefined> {
  let hoverMeta: vscode.Hover | undefined;
  for (let i = 0; i < struct.length; i++) {
    let targetName = struct[i].target.name;
    if (searchTerm === targetName) {

      const markdownTableIdWtLink = getMarkdownTableIdWtLink(struct[i].target);
      const tableSchema = await getTableSchemaAsMarkdown(struct[i].target.database, struct[i].target.schema, struct[i].target.name);
      const hoverData = new vscode.MarkdownString(markdownTableIdWtLink + "\n" + tableSchema);
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
  //@ts-ignore
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
  //@ts-ignore
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ) {
    let searchTerm = document.getText(
      document.getWordRangeAtPosition(position)
    );
    const line = document.lineAt(position.line).text;

    // early return
    if (line.indexOf("${") === -1) {
      return undefined;
    }

    const workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) {
      return;
    }

    if (line.indexOf("${self()}") !== -1 && searchTerm === "self") {
      const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder);
      if (!dataformCompiledJson) {
        return;
      }

      let tables = dataformCompiledJson?.tables;
      let operations = dataformCompiledJson?.operations;
      let assertions = dataformCompiledJson?.assertions;

      let relativeFilePath = path.relative(workspaceFolder, document.uri.fsPath);
      const getHoverForTarget = (target: Target) => {
        const markdownTableIdWtLink = getMarkdownTableIdWtLink(target);
        return new vscode.Hover(new vscode.MarkdownString(`#### ${markdownTableIdWtLink}`));
      };

      const findMatchingTarget = (items?: Table[] | Operation[] | Assertion[]) => {
        const match = items?.find(item => item.fileName === relativeFilePath);
        return match?.target;
      };

      const target = findMatchingTarget(operations) || findMatchingTarget(tables) || findMatchingTarget(assertions);

      if (target) {
        return getHoverForTarget(target);
      }

    }

    if (line.indexOf("${ref") !== -1) {
    let hoverMeta: vscode.Hover | undefined;

    const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder);
    if (!dataformCompiledJson) {
        return;
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
          const hoverMarkdownString = new vscode.MarkdownString();
          hoverMarkdownString.appendMarkdown(`#### ${markdownTableIdWtLink} \n`);

          const tableSchema = await getTableSchemaAsMarkdown(declarations[i].target.database, declarations[i].target.schema, declarations[i].target.name);
          hoverMarkdownString.appendMarkdown(tableSchema);
          hoverMarkdownString.isTrusted = true; // Allows command links
          return new vscode.Hover(hoverMarkdownString);
        }
      }
    }

    if (tablePrefix) {
      searchTerm = tablePrefix + "_" + searchTerm;
    }

    if (tables) {
      hoverMeta = await getTableInformationFromRef(searchTerm, tables);
    }
    if (hoverMeta) {
      return hoverMeta;
    }

    if (operations) {
      hoverMeta = await getFullTableNameFromRef(searchTerm, operations);
    }
    if (hoverMeta) {
      return hoverMeta;
    }

    if (assertions) {
      return await getFullTableNameFromRef(searchTerm, assertions);
    }
  } else {
    const regex = /\$\{([^}]+)\}/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
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

export class DataformConfigProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ) {
    // TODO: Add more hover documentation for config block here
    const line = document.lineAt(position.line).text;
    if (line.includes("nonNull:")) {
      return new vscode.Hover(new vscode.MarkdownString(`#### assertion: ( nonNull )

    This condition asserts that the specified columns are not null across all table rows
    The following code sample shows a nonNull assertion in the config block of a table:

      config {
      type: "table",
      assertions: {
        nonNull: ["user_id", "customer_id", "email"]
        }
      }
      SELECT ...
        `));
    } else if (line.includes("rowConditions:")){
      return new vscode.Hover(new vscode.MarkdownString(`#### assertion: ( rowConditions )

      This condition asserts that all table rows follow the custom logic you define.
      Each row condition is a custom SQL expression, and each table row is evaluated against each row condition. The assertion fails if any table row results in false.

      config {
        type: "incremental",
        assertions: {
          rowConditions: [
            'signup_date is null or signup_date > "2022-08-01"',
            'email like "%@%.%"'
          ]
        }
      }
      SELECT ...
        `));

    } else if (line.includes("uniqueKey:")){
      return new vscode.Hover(new vscode.MarkdownString(`#### assertion: ( uniqueKey )

      This condition asserts that, in a specified column, no table rows have the same value.
      The following code sample shows a uniqueKey assertion in the config block of a view:

      config {
        type: "view",
        assertions: {
          uniqueKey: ["user_id"]
        }
      }
      SELECT ...
        `));

    } else if (line.includes("assertions:")){
      return new vscode.Hover(new vscode.MarkdownString(`#### [Dataform assertion documentation](https://cloud.google.com/dataform/docs/assertions)`));
    } else {
        const range = document.getWordRangeAtPosition(position);
        if (!range) {
            return null;
        }
        const word = document.getText(range);

        if(sqlKeywordsToExcludeFromHoverDefinition.includes(word.toLowerCase())){
          return null;
        }

        if(columnHoverDescription){
          const matchingColumns = columnHoverDescription.fields.filter(
            (item: ColumnMetadata) => item.name.toLowerCase() === word.toLowerCase()
          );
          
          if(matchingColumns.length > 0){
            // Collect unique descriptions (non-empty) and types
            const uniqueDescriptions = new Set<string>();
            const types = new Set<string>();
            
            matchingColumns.forEach((column: ColumnMetadata) => {
              if(column.description && column.description.trim() !== ""){
                uniqueDescriptions.add(column.description.trim());
              }
              if(column.type){
                types.add(column.type);
              }
            });
            
            // Build hover content
            let hoverContent = "";
            
            // Add unique descriptions if any exist
            if(uniqueDescriptions.size > 0){
              Array.from(uniqueDescriptions).forEach((description) => {
                hoverContent += `${description}\n\n`;
              });
            }
            
            // Add type information
            if(types.size > 0){
              const typeList = Array.from(types).join(", ");
              hoverContent += `type: [${typeList}]\n\n`;
            }
            
            if(hoverContent.trim() !== ""){
              return new vscode.Hover(new vscode.MarkdownString(hoverContent.trim()));
            }
          }
        }
    }

    return undefined;
  }
}

export class DataformBigQueryHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
            const range = document.getWordRangeAtPosition(position);
            if (!range) {
                return null;
            }
            
            const word = document.getText(range);
            
            if (bigQuerySnippetMetadata[`${word}()`]) {
                const snippet = bigQuerySnippetMetadata[`${word}()`];
                
                const hoverContent = new vscode.MarkdownString();
                
                if (Array.isArray(snippet.description)) {
                    const markdownDescription = snippet.description.join('\n\n');
                    hoverContent.appendMarkdown(markdownDescription);
                } else if (snippet.description) {
                    hoverContent.appendMarkdown(snippet.description);
                }
                
                if (Array.isArray(snippet.body)) {
                    hoverContent.appendCodeblock(snippet.body.join('\n'), 'sqlx');
                } else {
                    hoverContent.appendCodeblock(snippet.body, 'sqlx');
                }
                
                return new vscode.Hover(hoverContent, range);
            }
            
            return null;
        }
};