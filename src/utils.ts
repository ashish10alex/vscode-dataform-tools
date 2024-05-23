import * as vscode from 'vscode';
const { execSync } = require('child_process');

const shell = (cmd: string) => execSync(cmd, { encoding: 'utf8' });

export function executableIsAvailable(name: string) {
	try { shell(`which ${name}`); return true ;}
	catch (error) { return false ;}
}

// Get start and end line number of the config block in the .sqlx file
// This assumes that the user is using config { } block at the top of the .sqlx file
//
// @return [start_of_config_block: number, end_of_config_block: number]


export const getLineNumberWhereConfigBlockTerminates = (): [number, number] => {
    let startOfConfigBlock = 0;
    let endOfConfigBlock = 0;
    let isInInnerConfigBlock = false;
    let innerConfigBlockCount = 0;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return [0, 0];
    }

    const document = editor.document;
    const totalLines = document.lineCount;

    for (let i = 0; i < totalLines; i++) {
        const lineContents = document.lineAt(i).text;

        if (lineContents.match("config")) {
            startOfConfigBlock = i + 1;
        } else if (lineContents.match("{")) {
            isInInnerConfigBlock = true;
            innerConfigBlockCount += 1;
        } else if (lineContents.match("}") && isInInnerConfigBlock && innerConfigBlockCount >= 1) {
            innerConfigBlockCount -= 1;
        } else if (lineContents.match("}") && innerConfigBlockCount === 0) {
            endOfConfigBlock = i + 1;
            return [startOfConfigBlock, endOfConfigBlock];
        }
    }

    return [0, 0];
};

export function isNotUndefined(value: unknown): any {
    if (typeof value === undefined){ throw new Error("Not a string");}
  }