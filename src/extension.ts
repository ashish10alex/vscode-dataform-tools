import * as vscode from 'vscode';
import { clearAuthenticationCheckInterval } from './bigqueryClient';
import { initializeExtension } from './extensionSetup';
import { logger } from './logger';

export async function activate(context: vscode.ExtensionContext) {
    await initializeExtension(context);
}

export function deactivate() {
    logger.info('Deactivating Dataform Tools extension');
    clearAuthenticationCheckInterval();
    logger.info('Extension "vscode-dataform-tools" is now deactivated.');
}
