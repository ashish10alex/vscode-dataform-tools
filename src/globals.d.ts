import { DataformCompiledJson } from "./types";

declare global {
  var CACHED_COMPILED_DATAFORM_JSON: DataformCompiledJson | undefined;
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


export {};
