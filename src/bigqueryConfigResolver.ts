import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from './logger';

export interface BigQueryConfig {
    projectId?: string;
    location?: string;
}

export interface ConfigSource {
    source: 'workflow_settings' | 'environment' | 'gcloud_config' | 'adc_metadata' | 'vscode_settings' | 'default';
    projectId?: string;
    location?: string;
}

/**
 * Resolves BigQuery configuration from multiple sources in priority order:
 * 1. workflow_settings.yaml (defaultProject, defaultLocation)
 * 2. Environment variables (GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_REGION, etc.)
 * 3. gcloud config (gcloud config get-value project, gcloud config get-value compute/region)
 * 4. Application Default Credentials metadata (if available)
 * 5. VS Code settings (vscode-dataform-tools.gcpProjectId, vscode-dataform-tools.gcpRegion)
 */
export async function resolveBigQueryConfig(): Promise<{ config: BigQueryConfig; sources: ConfigSource[] }> {
    const sources: ConfigSource[] = [];
    const config: BigQueryConfig = {};

    // 1. Check workflow_settings.yaml
    try {
        const workflowConfig = await getWorkflowSettingsConfig();
        if (workflowConfig.projectId || workflowConfig.location) {
            sources.push({
                source: 'workflow_settings',
                projectId: workflowConfig.projectId,
                location: workflowConfig.location
            });
            if (workflowConfig.projectId && !config.projectId) {
                config.projectId = workflowConfig.projectId;
            }
            if (workflowConfig.location && !config.location) {
                config.location = workflowConfig.location;
            }
        }
    } catch (error) {
        logger.debug(`Failed to read workflow_settings.yaml: ${error}`);
    }

    // 2. Check environment variables
    try {
        const envConfig = getEnvironmentConfig();
        if (envConfig.projectId || envConfig.location) {
            sources.push({
                source: 'environment',
                projectId: envConfig.projectId,
                location: envConfig.location
            });
            if (envConfig.projectId && !config.projectId) {
                config.projectId = envConfig.projectId;
            }
            if (envConfig.location && !config.location) {
                config.location = envConfig.location;
            }
        }
    } catch (error) {
        logger.debug(`Failed to read environment variables: ${error}`);
    }

    // 3. Check gcloud config
    try {
        const gcloudConfig = await getGcloudConfig();
        if (gcloudConfig.projectId || gcloudConfig.location) {
            sources.push({
                source: 'gcloud_config',
                projectId: gcloudConfig.projectId,
                location: gcloudConfig.location
            });
            if (gcloudConfig.projectId && !config.projectId) {
                config.projectId = gcloudConfig.projectId;
            }
            if (gcloudConfig.location && !config.location) {
                config.location = gcloudConfig.location;
            }
        }
    } catch (error) {
        logger.debug(`Failed to read gcloud config: ${error}`);
    }

    // 4. Check Application Default Credentials metadata (if available)
    try {
        const adcConfig = await getADCConfig();
        if (adcConfig.projectId || adcConfig.location) {
            sources.push({
                source: 'adc_metadata',
                projectId: adcConfig.projectId,
                location: adcConfig.location
            });
            if (adcConfig.projectId && !config.projectId) {
                config.projectId = adcConfig.projectId;
            }
            if (adcConfig.location && !config.location) {
                config.location = adcConfig.location;
            }
        }
    } catch (error) {
        logger.debug(`Failed to read ADC metadata: ${error}`);
    }

    // 5. Check VS Code settings (fallback)
    try {
        const vscodeConfig = getVSCodeConfig();
        if (vscodeConfig.projectId || vscodeConfig.location) {
            sources.push({
                source: 'vscode_settings',
                projectId: vscodeConfig.projectId,
                location: vscodeConfig.location
            });
            if (vscodeConfig.projectId && !config.projectId) {
                config.projectId = vscodeConfig.projectId;
            }
            if (vscodeConfig.location && !config.location) {
                config.location = vscodeConfig.location;
            }
        }
    } catch (error) {
        logger.debug(`Failed to read VS Code settings: ${error}`);
    }

    logger.debug(`Resolved BigQuery config: ${JSON.stringify({ config, sources })}`);
    return { config, sources };
}

async function getWorkflowSettingsConfig(): Promise<BigQueryConfig> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        return {};
    }

    const workflowSettingsPath = path.join(workspaceFolder, 'workflow_settings.yaml');
    if (!fs.existsSync(workflowSettingsPath)) {
        return {};
    }

    try {
        const content = fs.readFileSync(workflowSettingsPath, 'utf8');
        const config: BigQueryConfig = {};

        // More robust YAML parsing for the specific keys we need
        // Handle quoted and unquoted values, different spacing, etc.
        const projectMatch = content.match(/^defaultProject\s*:\s*['"]?([^'"#\r\n]+?)['"]?\s*(?:#.*)?$/m);
        const locationMatch = content.match(/^defaultLocation\s*:\s*['"]?([^'"#\r\n]+?)['"]?\s*(?:#.*)?$/m);

        if (projectMatch) {
            config.projectId = projectMatch[1].trim();
        }
        if (locationMatch) {
            config.location = locationMatch[1].trim();
        }

        return config;
    } catch (error) {
        logger.debug(`Error parsing workflow_settings.yaml: ${error}`);
        return {};
    }
}

function getEnvironmentConfig(): BigQueryConfig {
    const config: BigQueryConfig = {};

    // Check various environment variables that could specify GCP project
    const projectEnvVars = [
        'GOOGLE_CLOUD_PROJECT',
        'GCLOUD_PROJECT', 
        'GCP_PROJECT',
        'GOOGLE_CLOUD_PROJECT_ID',
        'CLOUDSDK_CORE_PROJECT' // gcloud SDK default project
    ];

    for (const envVar of projectEnvVars) {
        const value = process.env[envVar];
        if (value && value.trim() && !config.projectId) {
            config.projectId = value.trim();
            break;
        }
    }

    // Check various environment variables that could specify GCP region/location
    const locationEnvVars = [
        'GOOGLE_CLOUD_REGION',
        'GCLOUD_REGION',
        'GCP_REGION',
        'GOOGLE_CLOUD_LOCATION',
        'GCLOUD_LOCATION',
        'GCP_LOCATION',
        'CLOUDSDK_COMPUTE_REGION' // gcloud SDK default region
    ];

    for (const envVar of locationEnvVars) {
        const value = process.env[envVar];
        if (value && value.trim() && !config.location) {
            config.location = value.trim();
            break;
        }
    }

    return config;
}

async function getGcloudConfig(): Promise<BigQueryConfig> {
    const config: BigQueryConfig = {};

    try {
        // Get project from gcloud config
        const projectResult = execSync('gcloud config get-value project', { 
            encoding: 'utf8', 
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (projectResult && projectResult !== '(unset)') {
            config.projectId = projectResult;
        }
    } catch (error) {
        logger.debug(`Failed to get gcloud project config: ${error}`);
    }

    try {
        // Get region from gcloud config - try multiple possible config keys
        const regionKeys = ['compute/region', 'dataflow/region', 'config/region'];
        
        for (const key of regionKeys) {
            try {
                const regionResult = execSync(`gcloud config get-value ${key}`, { 
                    encoding: 'utf8', 
                    timeout: 5000,
                    stdio: ['pipe', 'pipe', 'pipe']
                }).trim();
                if (regionResult && regionResult !== '(unset)' && !config.location) {
                    config.location = regionResult;
                    break;
                }
            } catch (error) {
                // Continue trying other keys
                continue;
            }
        }
    } catch (error) {
        logger.debug(`Failed to get gcloud region config: ${error}`);
    }

    return config;
}

async function getADCConfig(): Promise<BigQueryConfig> {
    const config: BigQueryConfig = {};

    try {
        // Try to get ADC information using gcloud
        // This will work if user has set up ADC using `gcloud auth application-default login`
        const adcResult = execSync('gcloud auth application-default print-access-token --format="value(project_id)"', {
            encoding: 'utf8',
            timeout: 3000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        
        if (adcResult && adcResult !== '(unset)' && !adcResult.includes('ERROR')) {
            // Note: This command doesn't actually return project_id, it returns an access token
            // We'll try a different approach to get project from ADC
        }
    } catch (error) {
        // ADC might not be available or configured
        logger.debug('ADC not available or configured');
    }

    // Alternative: Try to read from well-known ADC file locations
    try {
        const os = require('os');
        const adcPaths = [
            path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'),
            // Windows path
            path.join(os.homedir(), 'AppData', 'Roaming', 'gcloud', 'application_default_credentials.json')
        ];

        for (const adcPath of adcPaths) {
            if (fs.existsSync(adcPath)) {
                const adcContent = fs.readFileSync(adcPath, 'utf8');
                const adcData = JSON.parse(adcContent);
                
                // Some ADC files contain project_id or quota_project_id
                if (adcData.project_id && !config.projectId) {
                    config.projectId = adcData.project_id;
                }
                if (adcData.quota_project_id && !config.projectId) {
                    config.projectId = adcData.quota_project_id;
                }
                break;
            }
        }
    } catch (error) {
        logger.debug(`Failed to read ADC file: ${error}`);
    }

    return config;
}

function getVSCodeConfig(): BigQueryConfig {
    const config: BigQueryConfig = {};
    const vscodeConfig = vscode.workspace.getConfiguration('vscode-dataform-tools');

    const projectId = vscodeConfig.get<string>('gcpProjectId');
    if (projectId) {
        config.projectId = projectId;
    }

    const location = vscodeConfig.get<string>('gcpRegion');
    if (location) {
        config.location = location;
    }

    return config;
}

/**
 * Gets a summary string describing where the config values came from
 */
export function getConfigSourceSummary(sources: ConfigSource[]): string {
    if (sources.length === 0) {
        return 'No configuration sources found';
    }

    const summaryParts = sources.map(source => {
        const parts = [];
        if (source.projectId) {
            parts.push(`project: ${source.source}`);
        }
        if (source.location) {
            parts.push(`location: ${source.source}`);
        }
        return parts.join(', ');
    });

    return summaryParts.filter(part => part.length > 0).join('; ');
}