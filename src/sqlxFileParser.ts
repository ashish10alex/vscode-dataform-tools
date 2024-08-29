import * as vscode from "vscode";
import { SqlxBlockMetadata, PreOpsBlockMeta, PostOpsBlockMeta } from "./types";


function countCurlyBraces(str:string): {
    openBraces: number;
    closedBraces: number;
} {
    const openBraces = (str.match(/\{/g) || []).length;
    const closedBraces = (str.match(/\}/g) || []).length;

    return {
      openBraces: openBraces,
      closedBraces: closedBraces
    };
  }

/**
    * This function is used to get start / end points for different blocks in an sqlx file
    * An sqlx file can have a config block followed by pre_operations / post_operations and an sql block
*/
export const getMetadataForSqlxFileBlocks = (document:vscode.TextDocument): SqlxBlockMetadata => {

    let inMajorBlock = false;

    /**vars for config block tracking */
    let startOfConfigBlock = 0;
    let endOfConfigBlock = 0;
    let configBlockExsists = false;

    /**vars for pre_operations block tracking */
    let preOpsBlockMeta: PreOpsBlockMeta = {preOpsList: []};
    let startOfPreOperationsBlock = 0;
    let endOfPreOperationsBlock = 0;

    /**vars for post_operations block tracking */
    let postOpsBlockMeta: PostOpsBlockMeta = {postOpsList: []};
    let startOfPostOperationsBlock = 0;
    let endOfPostOperationsBlock = 0;

    /**vars for sql code block tracking */
    let startOfSqlBlock = 0;
    let endOfSqlBlock = 0;
    let sqlBlockExsists = false;

    /**vars for inner blocks (defined by curley braces {} ) tracking */
    let openBracesCount = 0;
    let closedBracesCount = 0;

    let currentBlock = "";

    const totalLines = document.lineCount;

    for (let i = 0; i < totalLines; i++) {
        const lineContents = document.lineAt(i).text;
            const curleyBraceMeta = countCurlyBraces(lineContents);
            const openBraces = curleyBraceMeta.openBraces;
            const closedBraces = curleyBraceMeta.closedBraces;
        
        openBracesCount += openBraces;
        closedBracesCount += closedBraces;

        if (lineContents.match("config {") && !inMajorBlock) {
            currentBlock = "config";
            startOfConfigBlock = i + 1;
            inMajorBlock = true;

            if(openBracesCount === closedBracesCount && inMajorBlock){
                currentBlock = "";
                inMajorBlock = false;
                endOfConfigBlock = i + 1;
                configBlockExsists = true;
            }

        } else if (lineContents.match("post_operations {") && !inMajorBlock){
            currentBlock = "post_operations";
            startOfPostOperationsBlock = i+1;
            inMajorBlock = true;

            if((openBraces === closedBraces) && inMajorBlock){
                currentBlock = "";
                inMajorBlock = false;
                endOfPostOperationsBlock = i + 1;
                postOpsBlockMeta.postOpsList.push(
                    {
                        startLine: startOfPostOperationsBlock,
                        endLine: endOfPostOperationsBlock,
                        exists: true
                    },
                );
            }

        } else if (lineContents.match("pre_operations {") && !inMajorBlock){
            currentBlock = "pre_operations";
            startOfPreOperationsBlock = i+1;
            inMajorBlock = true;

            if((openBraces === closedBraces) && inMajorBlock){
                currentBlock = "";
                inMajorBlock = false;
                endOfPreOperationsBlock = i + 1;
                preOpsBlockMeta.preOpsList.push(
                    {
                        startLine: startOfPreOperationsBlock,
                        endLine: endOfPreOperationsBlock,
                        exists: true
                    },
                );
            }
        } else if (inMajorBlock && (openBracesCount === closedBracesCount)) {
            if (currentBlock === "config"){
                endOfConfigBlock = i + 1;
                configBlockExsists = true;
                currentBlock = "";
            } else if (currentBlock === "pre_operations") {
                endOfPreOperationsBlock = i + 1;
                preOpsBlockMeta.preOpsList.push(
                    {
                        startLine: startOfPreOperationsBlock,
                        endLine: endOfPreOperationsBlock,
                        exists: true
                    },
                );
                currentBlock = "";
            } else if (currentBlock === "post_operations") {
                endOfPostOperationsBlock = i + 1;
                postOpsBlockMeta.postOpsList.push(
                    {
                        startLine: startOfPostOperationsBlock,
                        endLine: endOfPostOperationsBlock,
                        exists: true
                    },
                );
                currentBlock = "";
            }
            inMajorBlock = false;
        } else if (lineContents !== "" && !inMajorBlock){
            if (startOfSqlBlock === 0){
                startOfSqlBlock = i + 1;
                sqlBlockExsists = true;
                endOfSqlBlock = i + 1;
            }else{
                endOfSqlBlock = i + 1;
            }
        }
    }
    return {
        configBlock: {startLine: startOfConfigBlock, endLine: endOfConfigBlock, exists: configBlockExsists}
        , preOpsBlock: preOpsBlockMeta
        , postOpsBlock: postOpsBlockMeta
        , sqlBlock: {startLine: startOfSqlBlock, endLine: endOfSqlBlock, exists: sqlBlockExsists}
    };
};
