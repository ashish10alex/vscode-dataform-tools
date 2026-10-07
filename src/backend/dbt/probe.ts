import { execFile } from 'child_process';
import { stripAnsi } from './errors';

/*
 * What a dbt binary is, from one `dbt --version`: which of the two engines, its version, and whether it can talk to
 * BigQuery. The host probes each binary it resolves once, and shows what it found.
 */

export type DbtFlavour = 'dbt-core' | 'dbt v2';

export interface DbtProbe {
    /**
     * dbt-core 1.x, the Python engine, or dbt v2, the Fusion engine. Output that is neither's is taken for dbt v2,
     * the safe side: a dbt v2 Project is parsed before it is compiled, so that on-run hooks do not run unasked.
     */
    flavour: DbtFlavour;
    /** e.g. "1.12.5". Empty when the output was not recognised */
    version: string;
    /** How the dbt names itself, for the user: "dbt-core 1.12.5", "dbt 2.0.6", or the first line it printed */
    label: string;
    /** False when the output was neither engine's */
    recognised: boolean;
    /**
     * Whether the BigQuery adapter is there. dbt-core lists its adapters as plugins; dbt v2 has its adapters built
     * in. A dbt-core without it is still used: the compile's own error then says what is missing.
     */
    bigQueryAdapter: boolean;
    /** Why this dbt is not used, for the user: set for a dbt-core that writes a manifest older than the reader takes */
    unsupported?: string;
}

/** dbt-core 1.8 is the first to write manifest schema v12, the one the reader takes and dbt v2 writes */
const MINIMUM_CORE = [1, 8];

// dbt v2 prints "dbt 2.0.6"; dbt-core prints "Core:\n  - installed: 1.12.5" ("installed version: 1.0.0" before 1.5)
const V2_VERSION = /^dbt (\d+)\.(\d+)\S*/m;
const CORE_VERSION = /installed(?: version)?:\s*((\d+)\.(\d+)\S*)/;
const BIGQUERY_PLUGIN = /^\s*-\s*bigquery:/m;

function firstLine(output: string): string {
    return output.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}

/** Reads what `dbt --version` printed */
export function parseDbtVersion(output: string): DbtProbe {
    const text = stripAnsi(output);
    const core = CORE_VERSION.exec(text);
    if (core) {
        const probe: DbtProbe = { flavour: 'dbt-core', version: core[1], label: `dbt-core ${core[1]}`, recognised: true, bigQueryAdapter: BIGQUERY_PLUGIN.test(text) };
        const [major, minor] = [Number(core[2]), Number(core[3])];
        if (major < MINIMUM_CORE[0] || (major === MINIMUM_CORE[0] && minor < MINIMUM_CORE[1])) {
            probe.unsupported = `This is dbt-core ${core[1]}. dbt-core ${MINIMUM_CORE.join('.')} or later is needed, or dbt v2.`;
        }
        return probe;
    }
    const v2 = V2_VERSION.exec(text);
    if (v2) {
        return { flavour: 'dbt v2', version: v2[0].split(' ')[1], label: v2[0], recognised: true, bigQueryAdapter: true };
    }
    return { flavour: 'dbt v2', version: '', label: firstLine(text) || 'dbt', recognised: false, bigQueryAdapter: true };
}

/**
 * Runs `binary --version` and reads it. Rejects when the binary cannot be run or exits with an error, with what it
 * printed first, and with the signal's reason when the signal is aborted.
 */
export function probeDbt(binary: string, options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {}): Promise<DbtProbe> {
    return new Promise((resolve, reject) => {
        execFile(binary, ['--version'], { signal: options.signal, env: options.env ?? process.env, windowsHide: true }, (error, stdout, stderr) => {
            if (options.signal?.aborted) {
                reject(options.signal.reason);
            } else if (error) {
                const said = firstLine(stripAnsi(`${stderr}\n${stdout}`));
                reject(new Error(`Could not run ${binary} --version: ${said || error.message}`, { cause: error }));
            } else {
                // Read from both, so that it does not matter which one a release prints its version on
                resolve(parseDbtVersion(`${stdout}\n${stderr}`));
            }
        });
    });
}
