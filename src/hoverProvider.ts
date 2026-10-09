import * as vscode from "vscode";
import { compiledIndices } from './project';
import { loadBigQuery } from './lazySdk';
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
import { parse as parseLoose } from "acorn-loose";
import type { Comment, Node as AcornNode } from "acorn";
import { sqlKeywordsToExcludeFromHoverDefinition } from "./constants";
import { isOnConfigKey } from "./configBlock/providers";
import { perfCount } from "./perf";
import { resolveDataformOptions } from './project/dataformOptions';
import { extensionConfiguration } from './project/settings';
import { tableOfError, tableOfMetadata } from './project/heldTable';
import { SEARCH_COLUMNS_COMMAND, tableHoverText } from './project/tableHoverText';

/** The text of a table's hover as the Markdown a hover shows: its icons drawn, and its one command allowed to run */
export function tableHoverMarkdown(text: string): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(text);
  // The descriptions are text from the Project and from BigQuery: nothing but the link to search the columns may run
  markdown.isTrusted = { enabledCommands: [SEARCH_COLUMNS_COMMAND] };
  markdown.supportThemeIcons = true;
  return markdown;
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

type Declaration = AcornNode & { type: 'FunctionDeclaration' | 'ClassDeclaration' | 'VariableDeclarator'; id?: { type: string; name?: string } | null };

/** The first function, class or variable declaration named `name`, in source order (outer before inner) */
function findDeclaration(node: unknown, name: string): Declaration | undefined {
    let found: Declaration | undefined;
    const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        const candidate = value as Declaration;
        if (typeof candidate.type !== 'string') {
            return;
        }
        if ((candidate.type === 'FunctionDeclaration' || candidate.type === 'ClassDeclaration' || candidate.type === 'VariableDeclarator')
            && candidate.id?.type === 'Identifier' && candidate.id.name === name
            && (!found || candidate.start < found.start)) {
            found = candidate;
        }
        for (const key of Object.keys(candidate)) {
            if (key !== 'loc') {
                visit((candidate as any)[key]);
            }
        }
    };
    visit(node);
    return found;
}

/** Hovering over the uses of one includes file parses the same code again and again: keep the last few parses */
const MAX_PARSED_JS = 8;
const parsedJs = new Map<string, { program: AcornNode, comments: Comment[] } | undefined>();

function parseJsForHover(code: string): { program: AcornNode, comments: Comment[] } | undefined {
    if (parsedJs.has(code)) {
        const parsed = parsedJs.get(code);
        parsedJs.delete(code);
        parsedJs.set(code, parsed); // most recently used last
        return parsed;
    }
    let parsed: { program: AcornNode, comments: Comment[] } | undefined;
    try {
        const comments: Comment[] = [];
        const program = parseLoose(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowImportExportEverywhere: true, onComment: comments });
        parsed = { program, comments };
    } catch {
        parsed = undefined;
    }
    parsedJs.set(code, parsed);
    if (parsedJs.size > MAX_PARSED_JS) {
        parsedJs.delete(parsedJs.keys().next().value!);
    }
    return parsed;
}

function getHoverOfVariableInJsFileOrBlock(code: string, searchTerm:string): vscode.Hover|undefined {
    const parsed = parseJsForHover(code);
    if (!parsed) {
        return undefined;
    }
    const { program, comments } = parsed;
    const node = findDeclaration(program, searchTerm);
    if (!node) {
        return undefined;
    }

    const hoverContent = `\`\`\`javascript\n var ${code.slice(node.start, node.end)}\n\`\`\``;
    if (node.type === "VariableDeclarator") {
        return new vscode.Hover(new vscode.MarkdownString(hoverContent));
    }

    // The comments directly above the declaration, and whether one of them is a JSDoc block with tags
    let leadingStart = node.start;
    let hasJsDocTags = false;
    for (let i = comments.length - 1; i >= 0; i--) {
        const comment = comments[i];
        if (comment.end > leadingStart) {
            continue;
        }
        if (code.slice(comment.end, leadingStart).trim() !== "") {
            break;
        }
        leadingStart = comment.start;
        hasJsDocTags ||= comment.type === "Block" && comment.value.startsWith("*") && /(^|\s)@\w/.test(comment.value);
    }
    if (!hasJsDocTags) {
        return new vscode.Hover(new vscode.MarkdownString(hoverContent));
    }
    const jsDocFullText = code.slice(leadingStart, node.end);
    let {functionSignature, hoverContent: tagsContent, descriptionOnTopOfJsDoc}  = parseJsDocBlock(jsDocFullText, searchTerm);
    return new vscode.Hover(new vscode.MarkdownString(functionSignature + "\n\n" + descriptionOnTopOfJsDoc + '\n\n' + tagsContent));
}

/**
 * Fetches BigQuery table metadata, propagating any underlying error, so
 * the caller can surface real auth/permission/network failures to the user.
 */
export async function fetchTableMetadata(projectId: string, datasetId: string, tableId: string) {
  const serviceAccountJsonPath = extensionConfiguration().get('serviceAccountJsonPath');
  let options: { projectId: string; keyFilename?: string } = { projectId };
  if (serviceAccountJsonPath) {
    options = { ...options, keyFilename: serviceAccountJsonPath as string };
  }
  const bigqueryClient = new (await loadBigQuery())(options);
  const table = bigqueryClient.dataset(datasetId).table(tableId);
  perfCount('bq.getMetadata');
  const [metadata] = await table.getMetadata();
  return metadata;
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
      const fileNames = await fs.promises.readdir(includesPath);
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

/** The table a plain `project.dataset.table` id at the position names */
export function rawTableIdAt(document: vscode.TextDocument, position: vscode.Position): Target | undefined {
  const range = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
  if (!range) {
    return undefined;
  }
  const [database, schema, name] = document.getText(range).split('.');
  return { database, schema, name };
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
    const target = rawTableIdAt(document, position);
    if (target) {
      return { target, source: "rawBigQueryId", type: "table" };
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
    const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder, resolveDataformOptions(workspaceFolder));
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

  const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder, resolveDataformOptions(workspaceFolder));
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

  // Declarations are not in the target name lookup yet, which is why they are matched above.
  const node: any = (compiledIndices().targetNameMap.get(searchTerm) || [])[0];
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
      const table = await fetchTableMetadata(database, schema, name).then(tableOfMetadata, tableOfError);
      return new vscode.Hover(tableHoverMarkdown(tableHoverText({
        target: reference.target,
        // A raw id can point at anything: it is no Action of the Project
        ...(reference.source === "rawBigQueryId" ? {} : { kind: reference.type }),
        description: reference.description,
        columns: reference.columns,
        partition: reference.partitionBy,
      }, table, formatTimestamp)));
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

export class DataformColumnHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ) {
    // Config keys get their docs from the config block hover in src/configBlock/providers.ts
    if (isOnConfigKey(document, position)) {
      return null;
    }
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