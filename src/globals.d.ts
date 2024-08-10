import { DataformCompiledJson } from "./types";

declare global {
  var CACHED_COMPILED_DATAFORM_JSON: DataformCompiledJson | undefined;
}

export {};
