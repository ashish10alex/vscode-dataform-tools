#!/usr/bin/env node
// Takes the README's pictures (media/images/demo_*.png) of the website's live demo: the frame with the source file
// beside the real panel, in each state the README shows, light and dark. It serves the built website
// (`npm --prefix website run build` first), drives the frame as a visitor would, and fails when a state is not reached.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(repo, 'media', 'images');
const PORT = 3187;
const origin = `http://127.0.0.1:${PORT}`;

/** A button of the panel by the words on it */
const button = (panel, words) => panel.locator('button').filter({ hasText: new RegExp(`^\\s*${words}\\s*$`) }).first();
const run = (panel) => panel.locator('button[title^="Run this file"]');

// Each still: the frame it is of, and what a visitor does to get there. `panel` is the panel's iframe
const STILLS = [
    { name: 'compiled_query_dataform', act: async () => {} },
    {
        name: 'compiled_query_dbt',
        act: async ({ page, panel }) => {
            await page.locator('#still [role=tab]').filter({ hasText: 'dbt' }).click();
            await panel.getByText('dbt target').first().waitFor();
        },
    },
    {
        name: 'errors',
        frame: 'errors',
        act: async ({ panel }) => {
            await panel.getByText('Function not found').first().waitFor();
        },
    },
    {
        name: 'run_and_results',
        act: async ({ page, panel }) => {
            await run(panel).click();
            await panel.getByText('billed').first().waitFor({ timeout: 30_000 });
            await button(panel, 'Preview Data').click();
            await page.frameLocator('#still iframe[title*="query results"]').getByText('Manchester United').first().waitFor({ timeout: 20_000 });
        },
    },
    {
        name: 'hover',
        act: async ({ page }) => {
            await page.locator('#still [data-demo-hover]').hover();
            await page.locator('#still [role=tooltip]').waitFor({ state: 'visible' });
            await page.waitForTimeout(300);
        },
    },
    {
        // A file that reads three tables, one in each of defer to prod's states
        name: 'defer_to_prod',
        frame: 'defer',
        act: async ({ page, panel }) => {
            await panel.getByText('read from prod').first().waitFor();
            // The Compile row opens to the switch and the count; the count opens to each table and where it is read from
            await panel.locator('button[title="Show compile"]').click();
            await panel.locator('button').filter({ hasText: /upstream tables? read from prod/ }).last().click();
            if ((await page.locator('#still [data-demo-pill]').count()) !== 3) {
                throw new Error('the source does not say where each of its three tables is read from');
            }
        },
    },
    {
        // What only the panel shows: without the source file
        name: 'run_changed',
        panelOnly: true,
        act: async ({ panel }) => {
            await button(panel, 'Changed').click();
            await panel.getByText('fct_free_transfers').first().waitFor({ timeout: 10_000 });
        },
    },
];

if (!fs.existsSync(path.join(repo, 'website', '.next', 'BUILD_ID'))) {
    console.error('The website is not built: run `npm --prefix website run build` first (`just website-demo` does)');
    process.exit(2);
}

const server = spawn('npx', ['next', 'start', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: path.join(repo, 'website'), stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

for (let waited = 0; ; waited += 250) {
    if (await fetch(origin).then((response) => response.ok, () => false)) {
        break;
    }
    if (waited > 30_000) {
        console.error('The website did not start');
        process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
}

const browser = await chromium.launch();
const failures = [];
let taken = 0;

for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1320, height: 1400 }, deviceScaleFactor: 1.5, colorScheme: theme, reducedMotion: 'reduce', timezoneId: 'UTC', locale: 'en-GB' });
    // The website keeps the visitor's theme here
    await context.addInitScript((chosen) => localStorage.setItem('theme', chosen), theme);
    for (const still of STILLS) {
        const page = await context.newPage();
        try {
            await page.goto(`${origin}/still?frame=${still.frame ?? 'hero'}${still.panelOnly ? '&panel=1' : ''}`);
            const panel = page.frameLocator('#still iframe[title*="compiled query panel"]');
            // The panel has taken the screenshot's place
            await page.locator('#still iframe[title*="compiled query panel"].opacity-100').waitFor({ timeout: 30_000 });
            await still.act({ page, panel });
            await page.locator('#still iframe[title*="compiled query panel"].opacity-100').waitFor({ timeout: 30_000 });
            // A change of height and the fade of a note end within this
            await page.waitForTimeout(700);
            await page.locator('#still figure').screenshot({ path: path.join(out, `demo_${still.name}_${theme}.png`) });
            taken++;
        } catch (error) {
            failures.push(`${still.name} (${theme}): ${String(error.message ?? error).split('\n')[0]}`);
        }
        await page.close();
    }
    await context.close();
}

await browser.close();
stop();

if (failures.length) {
    console.error(`The README's pictures could not all be taken:\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(`README: ${taken} pictures written to media/images`);
