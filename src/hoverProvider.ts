import * as vscode from "vscode";
import {
  getWorkspaceFolder,
  runCompilation,
} from "./utils";
import { Assertion, DataformCompiledJson, Operation, Table } from "./types";


function getFullTableNameFromRef(
  searchTerm: string,
  struct: Operation[] | Assertion[] | Table[]
): vscode.Hover | undefined {
  let hoverMeta: vscode.Hover | undefined;
  for (let i = 0; i < struct.length; i++) {
    let targetName = struct[i].target.name;
    if (searchTerm === targetName) {
      hoverMeta = new vscode.Hover({
        language: "bash", // bash because it stands out for the format `gcp_project_id.dataset.table`
        value: `${struct[i].target.database}.${struct[i].target.schema}.${struct[i].target.name}`,
      });
    }
  }
  return hoverMeta;
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
    if (line.indexOf("${ref(") === -1) {
      return undefined;
    }

    let hoverMeta: vscode.Hover | undefined;

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder){return;}

    let dataformCompiledJson: DataformCompiledJson | undefined;
    if (!CACHED_COMPILED_DATAFORM_JSON) {
      vscode.window.showWarningMessage(
        "Compile the Dataform project once for faster go to definition"
      );
      dataformCompiledJson = await runCompilation(workspaceFolder);
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
          return new vscode.Hover({
            language: "bash", // bash because it stands out for the format `gcp_project_id.dataset.table`
            value: `${declarations[i].target.database}.${declarations[i].target.schema}.${declarations[i].target.name}`,
          });
        }
      }

      if (tablePrefix) {
        searchTerm = tablePrefix + "_" + searchTerm;
      }

      if (tables) {
        hoverMeta = getFullTableNameFromRef(searchTerm, tables);
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

      return undefined; // If not matches are found then we will not show anything on hover
    }
  }
}
