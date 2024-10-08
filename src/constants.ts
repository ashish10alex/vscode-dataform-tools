import os from 'os';
import path from 'path';

const tempDir = os.tmpdir();
export const compiledSqlFilePath = path.join(tempDir, "output.sql");
export const sqlFileToFormatPath = path.join(tempDir, "format.sql");
export const executablesToCheck = ['dataform', 'sqlfluff', 'gcloud'];
export const tableQueryOffset = 2;
export const incrementalTableOffset = 1;
export const assertionQueryOffset = 4;
