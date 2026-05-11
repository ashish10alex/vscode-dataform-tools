/* eslint-disable */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Two levels up from packages/dataform-graph-cli/.
const ROOT = path.resolve(__dirname, '..', '..');
const DIST_WEBVIEW = path.join(ROOT, 'dist');
const CLI_DIR = __dirname;
const CLI_DIST = path.join(CLI_DIR, 'dist');
const CLI_WEBVIEW_DIST = path.join(CLI_DIR, 'webview-dist');

function copyWebviewAssets() {
    if (!fs.existsSync(DIST_WEBVIEW)) {
        throw new Error(
            `Webview build output not found at ${DIST_WEBVIEW}. Run "npm run build:webviews" first.`
        );
    }
    fs.mkdirSync(CLI_WEBVIEW_DIST, { recursive: true });

    // Wipe stale files so removed chunks don't linger.
    for (const existing of fs.readdirSync(CLI_WEBVIEW_DIST)) {
        fs.rmSync(path.join(CLI_WEBVIEW_DIST, existing), { force: true, recursive: true });
    }

    // The dependency-graph webview is an ES module that pulls in shared chunks
    // (StyledSelect, data-table, react-select, etc.) by relative path. Copy
    // every .js/.css from the vite dist so cross-chunk imports resolve.
    for (const file of fs.readdirSync(DIST_WEBVIEW)) {
        if (file.endsWith('.js') || file.endsWith('.css')) {
            fs.copyFileSync(path.join(DIST_WEBVIEW, file), path.join(CLI_WEBVIEW_DIST, file));
        }
    }
}

async function buildCli() {
    fs.mkdirSync(CLI_DIST, { recursive: true });
    await esbuild.build({
        entryPoints: [path.join(CLI_DIR, 'src', 'bin.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        outfile: path.join(CLI_DIST, 'bin.js'),
        banner: { js: '#!/usr/bin/env node' },
        sourcemap: true,
        logLevel: 'info',
    });
    fs.chmodSync(path.join(CLI_DIST, 'bin.js'), 0o755);
}

async function main() {
    copyWebviewAssets();
    await buildCli();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
