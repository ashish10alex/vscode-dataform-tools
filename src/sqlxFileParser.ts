import * as vscode from "vscode";
import { SqlxBlockMetadata, PreOpsBlockMeta, PostOpsBlockMeta } from "./types";

function countCurlyBraces(str: string): {
      openBraces: number;
      closedBraces: number;
  } {
      let openBraces = 0;
      let closedBraces = 0;

      for (let i = 0; i < str.length; i++) {
          if (str[i] === '{') {
              openBraces++;
          } else if (str[i] === '}') {
              closedBraces++;
          }
      }
      return {
          openBraces: openBraces,
          closedBraces: closedBraces
      };
  }

function isEmptyOrWhitespace(str:string) {
  return str.trim().length === 0;
}

/**
    * This function is used to get start / end points for different blocks in an sqlx file
    * An sqlx file can have a config block followed by pre_operations / post_operations and an sql block
*/
export const getMetadataForSqlxFileBlocks = (document:vscode.TextDocument): SqlxBlockMetadata => {

    let inMajorBlock = false;

    /**vars for tracking js block */
    let startOfJsBlock = 0;
    let endOfJsBlock = 0;
    let jsBlockExsists = false;

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
        //TODO: Maybe we do not need to call this function if we are in a sql block ?
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

        } else if (lineContents.match("js {") && !inMajorBlock){
            currentBlock = "js";
            startOfJsBlock = i + 1;
            inMajorBlock = true;

            if(openBracesCount === closedBracesCount && inMajorBlock){
                currentBlock = "";
                inMajorBlock = false;
                endOfJsBlock = i + 1;
                jsBlockExsists = true;
            }
        }
         else if (lineContents.match("post_operations {") && !inMajorBlock){
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
            } else if (currentBlock === "js") {
                currentBlock = "";
                endOfJsBlock = i + 1;
                jsBlockExsists = true;
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
        } else if (!isEmptyOrWhitespace(lineContents) && !inMajorBlock){
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
        , jsBlock: {startLine: startOfJsBlock, endLine: endOfJsBlock, exists: jsBlockExsists}
    };
};
