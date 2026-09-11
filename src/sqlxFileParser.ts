import * as vscode from "vscode";
import { SqlxBlockMetadata } from "./types";


export const getMetadataForSqlxFileBlocks = (document: vscode.TextDocument): SqlxBlockMetadata => {
    let inMajorBlock = false;
    let braceDepth = 0;
    let currentBlock = "";

    // Config block
    let startOfConfigBlock = 0;
    let endOfConfigBlock = 0;
    let configBlockExsists = false;

    // JS block
    let startOfJsBlock = 0;
    let endOfJsBlock = 0;
    let jsBlockExsists = false;

    // Pre-operations
    const preOpsList: Array<{startLine: number, endLine: number, exists: boolean}> = [];
    let startOfPreOperationsBlock = 0;

    // Post-operations
    const postOpsList: Array<{startLine: number, endLine: number, exists: boolean}> = [];
    let startOfPostOperationsBlock = 0;

    // SQL block
    let startOfSqlBlock = 0;
    let endOfSqlBlock = 0;
    let sqlBlockExsists = false;

    const totalLines = document.lineCount;

    for (let i = 0; i < totalLines; i++) {
        const line = document.lineAt(i).text;
        const trimmed = line.trim();
        
        // Skip empty lines early
        if (trimmed.length === 0) {continue;}

        // Count braces efficiently (only when needed)
        let openBraces = 0;
        let closedBraces = 0;
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '{') {openBraces++;}
            else if (char === '}') {closedBraces++;}
        }
        
        braceDepth += openBraces - closedBraces;

        // Check for block starts (avoid regex, use indexOf for speed)
        if (!inMajorBlock) {
            if (trimmed.startsWith('config {')) {
                currentBlock = "config";
                startOfConfigBlock = i + 1;
                inMajorBlock = true;
                
                // Reset SQL block if we found one before config (likely comments)
                startOfSqlBlock = 0;
                endOfSqlBlock = 0;
                sqlBlockExsists = false;
                
                // Single-line block check
                if (braceDepth === 0) {
                    endOfConfigBlock = i + 1;
                    configBlockExsists = true;
                    currentBlock = "";
                    inMajorBlock = false;
                }
            } else if (trimmed.startsWith('js {')) {
                currentBlock = "js";
                startOfJsBlock = i + 1;
                inMajorBlock = true;
                
                if (braceDepth === 0) {
                    endOfJsBlock = i + 1;
                    jsBlockExsists = true;
                    currentBlock = "";
                    inMajorBlock = false;
                }
            } else if (trimmed.startsWith('post_operations {')) {
                currentBlock = "post_operations";
                startOfPostOperationsBlock = i + 1;
                inMajorBlock = true;
                
                if (braceDepth === 0) {
                    postOpsList.push({
                        startLine: startOfPostOperationsBlock,
                        endLine: i + 1,
                        exists: true
                    });
                    currentBlock = "";
                    inMajorBlock = false;
                }
            } else if (trimmed.startsWith('pre_operations {')) {
                currentBlock = "pre_operations";
                startOfPreOperationsBlock = i + 1;
                inMajorBlock = true;
                
                if (braceDepth === 0) {
                    preOpsList.push({
                        startLine: startOfPreOperationsBlock,
                        endLine: i + 1,
                        exists: true
                    });
                    currentBlock = "";
                    inMajorBlock = false;
                }
            } else {
                // SQL block (anything not in a major block)
                if (startOfSqlBlock === 0) {
                    startOfSqlBlock = i + 1;
                    sqlBlockExsists = true;
                }
                endOfSqlBlock = i + 1;
            }
        } else if (braceDepth === 0) {
            // Block closing
            const endLine = i + 1;
            
            if (currentBlock === "config") {
                endOfConfigBlock = endLine;
                configBlockExsists = true;
            } else if (currentBlock === "js") {
                endOfJsBlock = endLine;
                jsBlockExsists = true;
            } else if (currentBlock === "pre_operations") {
                preOpsList.push({
                    startLine: startOfPreOperationsBlock,
                    endLine: endLine,
                    exists: true
                });
            } else if (currentBlock === "post_operations") {
                postOpsList.push({
                    startLine: startOfPostOperationsBlock,
                    endLine: endLine,
                    exists: true
                });
            }
            
            currentBlock = "";
            inMajorBlock = false;
        }
    }

    return {
        configBlock: {
            startLine: startOfConfigBlock,
            endLine: endOfConfigBlock,
            exists: configBlockExsists
        },
        preOpsBlock: { preOpsList },
        postOpsBlock: { postOpsList },
        sqlBlock: {
            startLine: startOfSqlBlock,
            endLine: endOfSqlBlock,
            exists: sqlBlockExsists
        },
        jsBlock: {
            startLine: startOfJsBlock,
            endLine: endOfJsBlock,
            exists: jsBlockExsists
        }
    };
};