import { Job } from "@google-cloud/bigquery";
import { CompiledQuerySchema, DataformCompiledJson, Metadata, Table, Assertion, Operation, Notebook, Target} from "./types";
import * as vscode from 'vscode';

declare global {
  var CACHED_COMPILED_DATAFORM_JSON: DataformCompiledJson | undefined;
}

declare global {
  var FILE_NODE_MAP: Map<string, (Table | Assertion | Operation | Notebook)[]>;
}

declare global {
  var TARGET_DEPENDENTS_MAP: Map<string, Target[]>;
}

declare global {
  var TARGET_NAME_MAP: Map<string, (Table | Assertion | Operation | Notebook)[]>;
}

declare  global {
  var cdnLinks : {
      highlightJsCssUri: string;
      highlightJsUri: string;
      highlightJsLineNoExtUri: string;
      tabulatorUri: string;
      tabulatorDarkCssUri: string;
      tabulatorLightCssUri: string;
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
  var bigQueryJob: Job |  undefined
}

declare global {
  var _bigQueryJobId: string |  undefined
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
  var compiledQuerySchema: CompiledQuerySchema | undefined;
}

declare global {
  var incrementalCheckBox: boolean
}

declare global {
  var schemaAutoCompletions: {name: string, metadata: Metadata }[];
}

declare global {
  var columnHoverDescription: CompiledQuerySchema | undefined;
}

declare global {
  var activeEditorFileName: string | undefined;
}

declare global {
  var activeDocumentObj: any;
}

declare global {
  var workspaceFolder: string | undefined;
}

declare global  {
  var errorInPreOpsDenyList: boolean
}

declare global {
  var bigQuerySnippetMetadata: {
    [key: string]: {
      prefix: string;
      body: string;
      description: string[];
    };
  };
}

declare global {
  var dataformFilesChangedSinceLastCompile: boolean;
}

declare global {
  var compilerOptionsMap: {
      assertionSchema?: string,
      databaseSuffix?: string,
      builtinAssertionNamePrefix?: string,
      defaultLocation?: string,
      tablePrefix?: string,
      vars?: {
          [key: string]: string;
      },
      schemaSuffix?: string,
      defaultSchema?: string,
      defaultDatabase?: string,
      defaultNotebookRuntimeOption?: string,
  };
}


declare global {
  var isWsl: boolean
}

export {};
