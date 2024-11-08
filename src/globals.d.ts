import { DataformCompiledJson } from "./types";
import * as vscode from 'vscode';

declare global {
  var CACHED_COMPILED_DATAFORM_JSON: DataformCompiledJson | undefined;
}

declare  global {
  var cdnLinks : {
      highlightJsCssUri: string;
      highlightJsUri: string;
      highlightJsCopyExtUri: string;
      highlightJsCopyExtCssUri: string;
      highlightJsLineNoExtUri: string;
      tabulatorCssUri: string;
      tabulatorUri: string;
      highlightJsOneDarkThemeUri: string;
      highlightJsOneLightThemeUri: string;
  }
}

declare global {
    var declarationsAndTargets: string[]
}

declare global {
    var dataformTags: string[]
}

declare global {
  var isRunningOnWindows: boolean
}

declare global {
  var bigQueryJob: any
}

declare global {
  var cancelBigQueryJobSignal: boolean
}

declare global {
  var queryLimit: number
}

declare global {
  var diagnosticCollection: vscode.DiagnosticCollection | undefined;
}


declare global {
  var compiledQuerySchema: any | undefined;
}

declare global {
  var incrementalCheckBox: boolean
}


export {};
