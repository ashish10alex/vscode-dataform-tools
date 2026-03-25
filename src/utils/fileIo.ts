import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { GitHubContentResponse } from '../types';

export function readFile(filePath: string) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

export async function writeCompiledSqlToFile(compiledQuery: string, filePath: string) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
    }
    fs.writeFileSync(filePath, compiledQuery, 'utf8');
}

export function checkIfFileExsists(filePath: string) {
    if (fs.existsSync(filePath)) {
        return true;
    }
    return false;
}

//@ts-ignore
const ensureDirectoryExistence = (filePath: string) => {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    fs.mkdirSync(dirname, { recursive: true });
};

export function writeContentsToFile(filePath: string, content: string) {
    ensureDirectoryExistence(filePath);
    fs.writeFile(filePath, content, (err) => {
        if (err) { throw err; };
        return;
    });
}

export async function fetchGitHubFileContent(): Promise<string> {
    //TODO: Should we move .sqlfluff to assets folder?
    const repo = 'vscode-dataform-tools';
    const filePath = 'src/test/test-workspace/.sqlfluff';
    const response = await fetch(`https://api.github.com/repos/ashish10alex/${repo}/contents/${filePath}`);

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as GitHubContentResponse;
    return Buffer.from(data.content, 'base64').toString('utf-8');
}

export async function ensureSqlfluffConfigExists(sqlfluffConfigFilePath: string) {
    if (!checkIfFileExsists(sqlfluffConfigFilePath)) {
        vscode.window.showInformationMessage(`Trying to fetch .sqlfluff file compatable with .sqlx files`);
        let sqlfluffConfigFileContents = await fetchGitHubFileContent();
        writeContentsToFile(sqlfluffConfigFilePath, sqlfluffConfigFileContents);
        vscode.window.showInformationMessage(`Created .sqlfluff file at ${sqlfluffConfigFilePath}`);
    }
}
