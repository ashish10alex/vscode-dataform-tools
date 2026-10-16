#!/usr/bin/env node
// Writes snippets/bigquery-functions.code-snippets.json from the catalog of BigQuery functions,
// snippets/bigquery-functions.json, by src/bigquery/functionCatalog.ts as `tsc` built it into out/.
//
// Usage: just bigquery-snippets

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { generatedSnippetsText } = require(path.join(repoRoot, "out", "src", "bigquery", "functionCatalog.js"));

const outFile = path.join(repoRoot, "snippets", "bigquery-functions.code-snippets.json");
fs.writeFileSync(outFile, generatedSnippetsText());
console.log(`wrote ${path.relative(repoRoot, outFile)}`);
