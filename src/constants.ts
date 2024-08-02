import os from 'os';
import path from 'path';

const tempDir = os.tmpdir();
export const compiledSqlFilePath = path.join(tempDir, "output.sql");
export const executablesToCheck = ['dataform', 'formatdataform'];
export const tableQueryOffset = 3;
export const assertionQueryOffset = 5;
