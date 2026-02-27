import * as vscode from 'vscode';
import { debounce } from './debounce';

export function registerConfigBlockDiagnostics(context: vscode.ExtensionContext) {
    const configDiagnosticCollection = vscode.languages.createDiagnosticCollection('dataformConfigDiagnostics');
    context.subscriptions.push(configDiagnosticCollection);

    const checkConfigBlockDiagnostics = (document: vscode.TextDocument) => {
        if (document.languageId !== 'sqlx') {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        let inConfigBlock = false;
        let inBigQueryBlock = false;
        let inAssertionBlock = false;
        let configBraceDepth = 0;
        let bigQueryBraceDepth = 0;
        let assertionBraceDepth = 0;
        
        // Scan up to 50 lines looking for the config block
        const maxLinesToScan = Math.min(document.lineCount, 50);

        for (let i = 0; i < maxLinesToScan; i++) {
            const line = document.lineAt(i).text;
            const trimmed = line.trim();

            if (trimmed.length === 0) { continue; }

            if (!inConfigBlock && trimmed.startsWith('config {')) {
                inConfigBlock = true;
                configBraceDepth = 1;
                if (trimmed.endsWith('}')) {
                    inConfigBlock = false;
                    configBraceDepth = 0;
                }
            } else if (inConfigBlock) {
                // Check for nested bigquery block
                if (!inBigQueryBlock && trimmed.match(/bigquery\s*:\s*\{/)) {
                    inBigQueryBlock = true;
                    bigQueryBraceDepth = 1;
                    if (trimmed.endsWith('}')) {
                        inBigQueryBlock = false;
                        bigQueryBraceDepth = 0;
                    }
                    continue; // Skip counting the first '{' of bigquery again
                }

                // Check for nested assertions block
                if (!inAssertionBlock && trimmed.match(/assertions\s*:\s*\{/)) {
                    inAssertionBlock = true;
                    assertionBraceDepth = 1;
                    if (trimmed.endsWith('}')) {
                        inAssertionBlock = false;
                        assertionBraceDepth = 0;
                    }
                    continue; // Skip counting the first '{' of assertions again
                }

                const addDiagnostic = (lineIndex: number, matchVal: string, message: string) => {
                    const startIndex = line.indexOf(matchVal);
                    const endIndex = startIndex + matchVal.length;
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(lineIndex, startIndex, lineIndex, endIndex),
                        message,
                        vscode.DiagnosticSeverity.Warning
                    ));
                };

                const checkBooleanProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const stringValMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(["'][^"']*["'])`));
                        if (stringValMatch) {
                            addDiagnostic(lineIndex, stringValMatch[1], `Invalid ${prop} value: ${stringValMatch[1]}. Must be a boolean (true or false) without quotes.`);
                        }
                        const invalidWordMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*([^"'\\s,{}]+)`));
                        if (invalidWordMatch && invalidWordMatch[1] !== 'true' && invalidWordMatch[1] !== 'false') {
                            addDiagnostic(lineIndex, invalidWordMatch[1], `Invalid ${prop} value: ${invalidWordMatch[1]}. Must be a boolean (true or false).`);
                        }
                    }
                };

                const checkNumberProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const stringValMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(["'][^"']*["'])`));
                        if (stringValMatch) {
                            addDiagnostic(lineIndex, stringValMatch[1], `Invalid ${prop} value: ${stringValMatch[1]}. Must be a number without quotes.`);
                        }
                        const nonNumberMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*([^\\s,"'{}\\[\\]]+)`));
                        if (nonNumberMatch && isNaN(Number(nonNumberMatch[1]))) {
                            addDiagnostic(lineIndex, nonNumberMatch[1], `Invalid ${prop} value: ${nonNumberMatch[1]}. Must be a number.`);
                        }
                    }
                };

                const checkArrayProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const nonArrayMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*([^\\s\\[]+)`));
                        if (nonArrayMatch) {
                            // If it starts with [ it is skipped by [^\s\[], which is correct array format
                            addDiagnostic(lineIndex, nonArrayMatch[1], `Invalid ${prop} value. Must be an array, e.g. ["example"].`);
                        }
                    }
                };

                const checkStringProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        // Match raw value assigned to property (ignoring anything wrapped in quotes/backticks which are safe)
                        const unquotedMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(?!['"\`])([^\\s,{}]+)`));
                        if (unquotedMatch) {
                            const val = unquotedMatch[1];
                            if (!isNaN(Number(val))) {
                                addDiagnostic(lineIndex, val, `Invalid ${prop} value: ${val}. Cannot be a number.`);
                            } else if (val === 'true' || val === 'false') {
                                addDiagnostic(lineIndex, val, `Invalid ${prop} value: ${val}. Cannot be a boolean.`);
                            }
                        }
                    }
                };

                const checkObjectOrRefProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const stringMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(["'][^"']*["'])`));
                        if (stringMatch) {
                            addDiagnostic(lineIndex, stringMatch[1], `Invalid ${prop} value. Cannot be a string.`);
                        }
                        const arrayMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(\\[)`));
                        if (arrayMatch) {
                            addDiagnostic(lineIndex, arrayMatch[1], `Invalid ${prop} value. Cannot be an array.`);
                        }
                        const primitiveMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(?!['"\`\\{\\[])([^\\s,{}]+)`));
                        if (primitiveMatch) {
                            const val = primitiveMatch[1];
                            if (!isNaN(Number(val))) {
                                addDiagnostic(lineIndex, val, `Invalid ${prop} value: ${val}. Cannot be a number.`);
                            } else if (val === 'true' || val === 'false') {
                                addDiagnostic(lineIndex, val, `Invalid ${prop} value: ${val}. Cannot be a boolean.`);
                            }
                        }
                    }
                };

                const checkSpecificStringProps = (props: { prop: string, validValues: string[] }[], currentLine: string, lineIndex: number) => {
                    for (const { prop, validValues } of props) {
                        const match = currentLine.match(new RegExp(`${prop}\\s*:\\s*["']([^"']+)["']`));
                        if (match) {
                            const value = match[1];
                            if (!validValues.includes(value)) {
                                addDiagnostic(lineIndex, value, `Invalid ${prop} value: "${value}". Must be one of: ${validValues.join(", ")}.`);
                            }
                        }
                    }
                };

                const checkTableNameConstraints = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const matchQuoted = currentLine.match(new RegExp(`${prop}\\s*:\\s*["']([^"']+)["']`));
                        
                        // We only validate explicit strings; unquoted values are likely JS variables (e.g., constants.TABLE_NAME)
                        if (matchQuoted) {
                            const value = matchQuoted[1];
                            // Valid characters per BigQuery: letters, numbers, underscores, dashes, spaces
                            const validPattern = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\p{Zs}]+$/u;
                            
                            if (!validPattern.test(value)) {
                                addDiagnostic(lineIndex, value, `Invalid ${prop} value: "${value}". BigQuery table names can only contain letters, numbers, underscores, dashes, and spaces.`);
                            }
                            if (value.length > 1024) {
                                addDiagnostic(lineIndex, value, `Invalid ${prop} value. Maximum length is 1024 characters.`);
                            }
                        }
                    }
                };

                const checkAllowedProperties = (allowedProps: string[], currentLine: string, lineIndex: number, blockName: string) => {
                    const propMatch = currentLine.match(/^\s*([a-zA-Z0-9_]+)\s*:/);
                    if (propMatch) {
                        const propName = propMatch[1];
                        if (!allowedProps.includes(propName)) {
                            addDiagnostic(lineIndex, propName, `Invalid property "${propName}" for ${blockName} block. Allowed properties: ${allowedProps.join(", ")}.`);
                        }
                    }
                };

                if (inBigQueryBlock) {
                    const allowedBigQueryProps = [
                        'partitionBy', 'clusterBy', 'requirePartitionFilter',
                        'partitionExpirationDays', 'labels', 'updatePartitionFilter', 'iceberg'
                    ];
                    if (bigQueryBraceDepth === 1) {
                        checkAllowedProperties(allowedBigQueryProps, line, i, 'bigquery');
                    }

                    checkBooleanProps(['requirePartitionFilter'], line, i);
                    checkNumberProps(['partitionExpirationDays'], line, i);
                    checkArrayProps(['clusterBy'], line, i);
                    checkStringProps(['partitionBy'], line, i);
                    checkObjectOrRefProps(['labels'], line, i);
                    
                    // Specific checking for bigquery string options (if any needed in the future)
                } else if (inAssertionBlock) {
                    const allowedAssertionProps = [
                        'nonNull', 'rowConditions', 'uniqueKey', 'uniqueKeys'
                    ];
                    if (assertionBraceDepth === 1) {
                        checkAllowedProperties(allowedAssertionProps, line, i, 'assertions');
                    }

                    checkArrayProps(['nonNull', 'rowConditions', 'uniqueKey', 'uniqueKeys'], line, i);
                } else {
                    const allowedConfigProps = [
                        'type', 'database', 'schema', 'name', 'description', 'columns',
                        'tags', 'dependencies', 'hasOutput', 'assertions', 'bigquery',
                        'materialized', 'onSchemaChange', 'protected', 'dependOnDependencyAssertions'
                    ];
                    if (configBraceDepth === 1) {
                        checkAllowedProperties(allowedConfigProps, line, i, 'config');
                    }

                    checkBooleanProps(['hasOutput', 'materialized', 'protected'], line, i);
                    checkArrayProps(['tags', 'dependencies'], line, i);
                    checkStringProps(['description', 'database', 'schema', 'name'], line, i);
                    checkObjectOrRefProps(['columns', 'assertions'], line, i);
                    checkTableNameConstraints(['name'], line, i);
                    
                    checkSpecificStringProps([
                        { prop: 'type', validValues: ["table", "view", "incremental", "inline", "declaration", "operations", "assertion"] },
                        { prop: 'onSchemaChange', validValues: ["IGNORE", "FAIL", "EXTEND", "SYNCHRONIZE"] }
                    ], line, i);
                }

                // Brace counting
                let openBraces = 0;
                let closedBraces = 0;
                for (let j = 0; j < line.length; j++) {
                    if (line[j] === '{') { openBraces++; }
                    else if (line[j] === '}') { closedBraces++; }
                }
                
                if (inBigQueryBlock) {
                    bigQueryBraceDepth += openBraces - closedBraces;
                    if (bigQueryBraceDepth <= 0) {
                        inBigQueryBlock = false;
                    }
                } else if (inAssertionBlock) {
                    assertionBraceDepth += openBraces - closedBraces;
                    if (assertionBraceDepth <= 0) {
                        inAssertionBlock = false;
                    }
                } else {
                    configBraceDepth += openBraces - closedBraces;
                    if (configBraceDepth <= 0) {
                        inConfigBlock = false;
                        break;
                    }
                }
            }
        }

        // We use our existing global diagnostic collection but append these specific warnings
        // making sure not to overwrite existing ones from the compile step, or we can just 
        // merge them. To keep it simple, we'll create a dedicated collection for these config lintings
        configDiagnosticCollection.set(document.uri, diagnostics);
    };

    // Initial check
    if (vscode.window.activeTextEditor) {
        checkConfigBlockDiagnostics(vscode.window.activeTextEditor.document);
    }

    const triggerConfigDiagnostics = debounce((document: vscode.TextDocument) => {
        checkConfigBlockDiagnostics(document);
    }, 500);

    // Check on open and change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => triggerConfigDiagnostics(e.document)),
        vscode.workspace.onDidOpenTextDocument(doc => checkConfigBlockDiagnostics(doc))
    );
}
