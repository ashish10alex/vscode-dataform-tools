import * as vscode from "vscode";
const { BigQuery } = require('@google-cloud/bigquery');
import {
  getWorkspaceFolder,
  getTextByLineRange,
  getOrCompileDataformJson,
  formatTimestamp,
} from "./utils";

// the comment-parser library does not have types in it so we have ignore the typescript error
// @ts-ignore
import {parse as commentParser} from 'comment-parser';

import { Assertion, Column, ColumnMetadata, Operation, Table, Target } from "./types";
import * as fs from "fs";
import * as path from "path";
import { getMetadataForSqlxFileBlocks} from "./sqlxFileParser";
import { createSourceFile, forEachChild, getJSDocTags, isClassDeclaration, isFunctionDeclaration, isIdentifier, isVariableDeclaration, Node, ScriptTarget } from "typescript";
import { maxHoverSchemaRows, sqlKeywordsToExcludeFromHoverDefinition } from "./constants";
import { applyColumnDescriptions, flattenSchemaRows } from "./utils/schemaTree";

async function createHoverContentForTable(tableMetadata:any, target: Target, partitionBy: string, type:string, compiledDescription?: string, columns?: Column[]): Promise<vscode.MarkdownString> {
          const hoverMarkdownString = new vscode.MarkdownString();

          const markdownTableIdWtLink = getMarkdownTableIdWtLink(target);
          hoverMarkdownString.appendMarkdown(`#### ${markdownTableIdWtLink}\n\n`);

          // The hover itself cannot be searched, so offer the quick pick over the same schema.
          // Kept directly under the title: at the bottom of a long schema table it is easy to miss.
          if (tableMetadata?.schema?.fields?.length) {
            const searchArgs = encodeURIComponent(JSON.stringify([target]));
            hoverMarkdownString.appendMarkdown(
              `[$(search) Search columns](command:vscode-dataform-tools.searchTableColumns?${searchArgs})\n\n`
            );
          }

          hoverMarkdownString.appendMarkdown("---- \n");

          // Prefer the description from BigQuery, fall back to the one in the compiled Dataform config
          const description = (tableMetadata?.description || compiledDescription || "").trim();
          if(description){
            hoverMarkdownString.appendMarkdown(`**Description:** `);
            hoverMarkdownString.appendText(description);
            hoverMarkdownString.appendMarkdown(`\n\n`);
          }

          if(type){
            const tableType = `**Type:** ${type}`;
            hoverMarkdownString.appendMarkdown(`${tableType}\n\n`);
          }

          const tableLocation = tableMetadata?.location;
          if(tableLocation){
            hoverMarkdownString.appendMarkdown(`**Location:** ${tableLocation}\n\n`);
          }


          if(partitionBy){
            hoverMarkdownString.appendMarkdown(`**Partition:** \`${partitionBy}\`\n\n`);
          }

          let lastModifiedTime = tableMetadata?.lastModifiedTime;
          if(lastModifiedTime){
            lastModifiedTime = new Date(parseInt(lastModifiedTime));
            lastModifiedTime = formatTimestamp(lastModifiedTime);
            hoverMarkdownString.appendMarkdown(`**Last Modified Time:** ${lastModifiedTime}\n\n`);
          }
          hoverMarkdownString.appendMarkdown("---- \n");

          const tableSchema = await getTableSchemaAsMarkdown(tableMetadata, columns);
          hoverMarkdownString.appendMarkdown(tableSchema);
          hoverMarkdownString.isTrusted = true;
          hoverMarkdownString.supportThemeIcons = true;
          return hoverMarkdownString;
}


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

/**
 * Fetches BigQuery table metadata, propagating any underlying error.
 * Use this when the caller wants to surface real auth/permission/network
 * failures to the user. Prefer {@link getTableMetadata} for callers that
 * just want best-effort metadata (e.g. hover providers).
 */
export async function fetchTableMetadata(projectId: string, datasetId: string, tableId: string) {
  const serviceAccountJsonPath = vscode.workspace.getConfiguration('vscode-dataform-tools').get('serviceAccountJsonPath');
  let options: { projectId: string; keyFilename?: string } = { projectId };
  if (serviceAccountJsonPath) {
    options = { ...options, keyFilename: serviceAccountJsonPath as string };
  }
  const bigqueryClient = new BigQuery(options);
  const table = bigqueryClient.dataset(datasetId).table(tableId);
  const [metadata] = await table.getMetadata();
  return metadata;
}

export async function getTableMetadata(projectId: string, datasetId:string, tableId:string) {
  try {
    return await fetchTableMetadata(projectId, datasetId, tableId);
  } catch (err) {
    console.error('Error:', err);
  }
}

/** Indent one level of nesting. Non breaking spaces survive the markdown table renderer. */
const nestedFieldIndent = "\u00A0\u00A0\u00A0";

/**
 * Newlines in a BigQuery description would split the markdown table across lines, so collapse
 * them. Overriding `toCellText` also disables tablemark's own escaping, hence the `|` handling.
 */
const toHoverCellText = (value: unknown): string =>
  String(value ?? "").replace(/\s*\r?\n\s*/g, " ").replace(/\|/g, "\\|");

async function getTableSchemaAsMarkdown(metadata:any, columns?: Column[]) {
  try {
    const fields: ColumnMetadata[] | undefined = metadata?.schema?.fields;
    if (!fields || fields.length === 0) {
      return "";
    }

    // Descriptions declared in the SQLX config block are not in BigQuery until the table is
    // rebuilt, so prefer them when the caller has a compiled action to hand.
    const describedFields = columns?.length ? applyColumnDescriptions(fields, columns) : fields;
    const { rows, omitted } = flattenSchemaRows(describedFields, { maxRows: maxHoverSchemaRows });

    const { default: tablemark } = await import('tablemark');
    const table = tablemark(
      rows.map((row) => ({
        name: row.depth === 0 ? row.name : `${nestedFieldIndent.repeat(row.depth - 1)}\u2514\u2500 ${row.name}`,
        type: row.type,
        description: row.description,
      })),
      { toCellText: toHoverCellText }
    );

    if (omitted > 0) {
      return `${table}\n\n_\u2026 ${omitted} more field${omitted === 1 ? "" : "s"} not shown, see the Schema tab_\n`;
    }
    return table;
  } catch (err) {
    console.error('Error:', err);
  }
  return "";
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


/** Where a table reference under the cursor came from. The hover renders each of these differently. */
export type TableReferenceSource = "rawBigQueryId" | "ref" | "declaration" | "self";

export interface ResolvedTableReference {
  target: Target;
  source: TableReferenceSource;
  /** Action type for display, e.g. "table", "view", "declaration". */
  type: string;
  columns?: Column[];
  description?: string;
  partitionBy?: string;
}

function isPositionInsideTemplate(line: string, position: vscode.Position): boolean {
  const templateRegex = /\$\{([^}]+)\}/g;
  let templateMatch;
  while ((templateMatch = templateRegex.exec(line)) !== null) {
    const start = templateMatch.index;
    const end = templateMatch.index + templateMatch[0].length;
    if (position.character >= start && position.character <= end) {
      return true;
    }
  }
  return false;
}

/**
 * Works out which table the cursor is on: a raw project.dataset.table id outside a template,
 * otherwise ${self()} or ${ref('...')} inside one. Shared by the hover and by the
 * "Search columns of table" command so both agree on what the table under the cursor is.
 */
export async function resolveTableReferenceAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<ResolvedTableReference | undefined> {
  const line = document.lineAt(position.line).text;

  if (!isPositionInsideTemplate(line, position)) {
    const bqTableRegex = /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/;
    const bqRange = document.getWordRangeAtPosition(position, bqTableRegex);
    if (bqRange) {
      const parts = document.getText(bqRange).split('.');
      if (parts.length === 3) {
        const [database, schema, name] = parts;
        return { target: { database, schema, name }, source: "rawBigQueryId", type: "table" };
      }
    }
    return undefined;
  }

  const workspaceFolder = await getWorkspaceFolder();
  if (!workspaceFolder) {
    return undefined;
  }

  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) {
    return undefined;
  }

  let searchTerm = document.getText(wordRange);

  if (line.indexOf("${self()}") !== -1 && searchTerm === "self") {
    const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder);
    if (!dataformCompiledJson) {
      return undefined;
    }
    const relativeFilePath = path.relative(workspaceFolder, document.uri.fsPath);
    const findMatch = (items?: Table[] | Operation[] | Assertion[]) =>
      items?.find(item => item.fileName === relativeFilePath);
    const match: any = findMatch(dataformCompiledJson?.operations)
      || findMatch(dataformCompiledJson?.tables)
      || findMatch(dataformCompiledJson?.assertions);
    if (match?.target) {
      return {
        target: match.target,
        source: "self",
        type: match.type || "table",
        columns: match.actionDescriptor?.columns,
        description: match.actionDescriptor?.description,
        partitionBy: match.bigquery?.partitionBy || "",
      };
    }
    return undefined;
  }

  if (line.indexOf("${ref") === -1) {
    return undefined;
  }

  const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder);
  if (!dataformCompiledJson) {
    return undefined;
  }

  const declarations = dataformCompiledJson?.declarations;
  if (declarations) {
    for (const declaration of declarations) {
      if (searchTerm === declaration.target.name) {
        return {
          target: declaration.target,
          source: "declaration",
          type: "declaration",
          columns: (declaration as any).actionDescriptor?.columns,
          description: (declaration as any).actionDescriptor?.description,
        };
      }
    }
  }

  const tablePrefix = dataformCompiledJson?.projectConfig?.tablePrefix;
  if (tablePrefix) {
    searchTerm = tablePrefix + "_" + searchTerm;
  }

  // Declarations are not in TARGET_NAME_MAP yet, which is why they are matched above.
  const node: any = (global.TARGET_NAME_MAP?.get(searchTerm) || [])[0];
  if (node?.target) {
    return {
      target: node.target,
      source: "ref",
      type: node.type || "table",
      columns: node.actionDescriptor?.columns,
      description: node.actionDescriptor?.description,
      partitionBy: node.bigquery?.partitionBy || "",
    };
  }

  return undefined;
}

export class DataformHoverProvider implements vscode.HoverProvider {
  //@ts-ignore
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ) {
    const line = document.lineAt(position.line).text;
    const reference = await resolveTableReferenceAtPosition(document, position);

    // ${self()} has always shown just the table id.
    if (reference?.source === "self") {
      return new vscode.Hover(new vscode.MarkdownString(`#### ${getMarkdownTableIdWtLink(reference.target)}`));
    }

    if (reference) {
      const { database, schema, name } = reference.target;
      const tableMetadata = await getTableMetadata(database, schema, name);

      // A raw id can point at anything, so say so rather than showing an empty card.
      if (!tableMetadata && reference.source === "rawBigQueryId") {
        const hoverMarkdownString = new vscode.MarkdownString(
          `#### ${getMarkdownTableIdWtLink(reference.target)}\n\n ---- \n\n $(warning) **Metadata unavailable**`
        );
        hoverMarkdownString.isTrusted = true;
        hoverMarkdownString.supportThemeIcons = true;
        return new vscode.Hover(hoverMarkdownString);
      }

      const hoverMarkdownString = await createHoverContentForTable(
        tableMetadata,
        reference.target,
        reference.partitionBy || "",
        reference.type,
        reference.description,
        reference.columns,
      );
      return new vscode.Hover(hoverMarkdownString);
    }

    // Not a table. Inside a ${...} that is not a ref it may still be a JS variable or function.
    if (!isPositionInsideTemplate(line, position) || line.indexOf("${ref") !== -1) {
      return undefined;
    }

    const workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }
    const searchTerm = document.getText(wordRange);

    const regex = /\$\{([^}]+)\}/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const content = match[1];
      if (content.includes(".")) {
        const [jsFileName, variableOrFunctionSignature] = content.split('.');
        if (variableOrFunctionSignature.includes(searchTerm)) {
          return findModuleVarDefinition(document, workspaceFolder, jsFileName, searchTerm, 0, -1);
        }
      } else if (content.includes('.') === false && content.trim() !== '') {
        const sqlxFileMetadata = getMetadataForSqlxFileBlocks(document);
        const jsBlock = sqlxFileMetadata.jsBlock;
        if (jsBlock.exists === true) {
          const jsBlockCode = await getTextByLineRange(document.uri, jsBlock.startLine, jsBlock.endLine);
          if (jsBlockCode) {
            return getHoverOfVariableInJsFileOrBlock(jsBlockCode, searchTerm);
          }
        }
      }
    }

    return undefined; // If no matches are found then we will not show anything on hover
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