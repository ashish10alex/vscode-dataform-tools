#!/usr/bin/env node
// Checks the website's live demo as it is under website/public/demo, in a headless browser, and takes the
// screenshots the hero shows until the panel has loaded. It fails when the committed bundle and the committed
// states no longer fit: a console error, a panel that does not render, or a run or preview that does not end.
//
//   node scripts/demo/check.mjs            check, and write the screenshots
//   node scripts/demo/check.mjs --no-posters   check only
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.join(repo, 'website', 'public');
const posters = !process.argv.includes('--no-posters');
// The panel's part of the hero's frame on a wide screen (website/components/landing/live-demo.tsx)
const PANEL = { width: 652, height: 580 };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
// The page the panels are checked in: as the website does, it holds them in iframes and hears what they tell
const HOLDER = `<!doctype html><title>check</title><body style="margin:0"><script>
  window.told = [];
  addEventListener('message', (event) => { if (event.data && event.data.source === 'vdt-demo') told.push(event.data); });
  const q = new URLSearchParams(location.search);
  const frame = document.createElement('iframe');
  frame.src = '/demo/' + q.get('page') + '.html?backend=' + q.get('backend') + '&theme=' + q.get('theme');
  frame.style.cssText = 'border:0;display:block;width:100vw;height:100vh';
  document.body.appendChild(frame);
</script>`;

const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/__holder') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(HOLDER);
        return;
    }
    const file = path.join(root, path.normalize(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const failures = [];
let checks = 0;

async function open(pageName, backend, theme) {
    const context = await browser.newContext({ viewport: PANEL, deviceScaleFactor: 2, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${origin}/__holder?page=${pageName}&backend=${backend}&theme=${theme}`);
    const frame = page.frameLocator('iframe');
    const told = (type) => page.evaluate((wanted) => window.told.filter((message) => message.type === wanted), type);
    return { context, page, frame, errors, told };
}

async function check(name, action) {
    checks++;
    try {
        await action();
    } catch (error) {
        failures.push(`${name}: ${String(error.message ?? error).split('\n')[0]}`);
    }
}

const run = (frame) => frame.locator('button[title^="Run this file"]');
/** A button of the panel by the words on it. Its tabs are buttons with the role of a tab */
const button = (frame, words) => frame.locator('button').filter({ hasText: new RegExp(`^\\s*${words}\\s*$`) }).first();

for (const backend of ['dataform', 'dbt']) {
    for (const theme of ['dark', 'light']) {
        const { context, page, frame, errors, told } = await open('panel', backend, theme);
        await check(`${backend} ${theme}: the panel renders`, async () => {
            await run(frame).waitFor({ timeout: 15_000 });
            await frame.getByText('268.88 MiB').first().waitFor({ timeout: 5000 });
            await frame.getByText('fct_player_transfers').first().waitFor();
            await page.waitForFunction(() => window.told.some((message) => message.type === 'rendered'), null, { timeout: 5000 });
            const notes = await told('note');
            if (notes.length) {
                throw new Error(`the panel asked for what the demo has no answer to, before any click: ${notes.map((note) => note.command).join(', ')}`);
            }
        });
        if (posters) {
            // The compile's age is told in words ("just now"), so two takes of a state are the same picture
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(root, 'demo', `poster-${backend}-${theme}.png`) });
        }
        if (theme === 'dark') {
            await check(`${backend}: Run ends`, async () => {
                await run(frame).click();
                await page.waitForFunction(() => window.told.some((message) => message.type === 'terminal'), null, { timeout: 3000 });
                await frame.getByText(backend === 'dbt' ? 'Sent to terminal' : '269.00 MiB billed').first().waitFor({ timeout: 20_000 });
            });
            await check(`${backend}: Preview Data asks for the results`, async () => {
                await button(frame, 'Preview Data').click();
                await page.waitForFunction(() => window.told.some((message) => message.type === 'preview'), null, { timeout: 3000 });
            });
            await check(`${backend}: the Project tab fills`, async () => {
                await button(frame, 'Project').click();
                await frame.getByText('/Users/you/football').first().waitFor({ timeout: 5000 });
            });
            await check(`${backend}: a click the demo has no answer to gives a note`, async () => {
                await button(frame, backend === 'dbt' ? 'Compiled query' : 'Query').click();
                await button(frame, 'Graph').click();
                await page.waitForFunction(() => window.told.some((message) => message.type === 'note' && message.command === 'showDependencyGraph'), null, { timeout: 3000 });
            });
        }
        if (backend === 'dataform' && theme === 'dark') {
            await check('dataform: a run through the API ends', async () => {
                await button(frame, 'API').click();
                await frame.getByText('Runs origin/main').waitFor({ timeout: 3000 });
                await run(frame).click();
                await frame.getByText('running').first().waitFor({ timeout: 6000 });
                await button(frame, 'Executions').click();
                await frame.getByText('Recent Executions (2)').waitFor({ timeout: 20_000 });
                await page.waitForFunction(() => !document.querySelector('iframe').contentDocument.body.innerText.includes('RUNNING'), null, { timeout: 20_000 });
            });
        }
        await check(`${backend} ${theme}: no console error`, async () => {
            if (errors.length) {
                throw new Error(errors.join(' | '));
            }
        });
        await context.close();
    }

    const { context, page, frame, errors } = await open('results', backend, 'dark');
    await check(`${backend}: the query results show the rows`, async () => {
        await frame.getByText('Manchester United').first().waitFor({ timeout: 15_000 });
        await page.waitForFunction(() => window.told.some((message) => message.type === 'results shown'));
        if (errors.length) {
            throw new Error(errors.join(' | '));
        }
    });
    await context.close();
}

await browser.close();
server.close();

if (failures.length) {
    console.error(`The live demo is broken (${failures.length} of ${checks} checks):\n  ${failures.join('\n  ')}`);
    process.exit(1);
}
console.log(`live demo: ${checks} checks passed${posters ? ', screenshots written to website/public/demo' : ''}`);
