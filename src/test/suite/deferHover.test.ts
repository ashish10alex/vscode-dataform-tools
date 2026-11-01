import * as assert from 'assert';
import { suite, test } from 'mocha';
import { deferHoverMarkdown, hoverText } from '../../shared/deferHover';

/** The span styles a VS Code hover keeps, as its Markdown renderer checks them (1.144) */
const KEPT_STYLE = /^(color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(display:inline-block;)?(border-radius:[0-9]+px;)?$/;

suite('deferHover', () => {
    const hover = deferHoverMarkdown({
        tone: 'prod',
        icon: 'arrow-right',
        heading: 'prod',
        sentence: 'Not built in dev, so read from prod.',
        dev: 'acme-dev.world_cup.AA_fct_matches',
        prod: 'acme-dev.world_cup.fct_matches',
        footer: ['[Open prod table in BigQuery](https://example.com)'],
    });

    test('highlights the table prefix only the dev name has', () => {
        assert.match(hover, /<code><span style="color:var\(--vscode-gitDecoration-deletedResourceForeground\);">dev <\/span> acme-dev\.world&#95;cup\.<span style="background-color:var\(--vscode-diffEditor-removedTextBackground\);border-radius:3px;">AA&#95;<\/span>fct&#95;matches<\/code>/);
        assert.match(hover, /<br><code><span style="color:var\(--vscode-gitDecoration-addedResourceForeground\);">prod<\/span> acme-dev\.world&#95;cup\.fct&#95;matches<\/code>/);
    });

    test('has the heading in the colour of the label after the ref, then the sentence and the link', () => {
        const parts = hover.split('\n\n');
        assert.strictEqual(parts[0], '<span style="color:var(--vscode-dataformTools-deferredRef-foreground);">$(arrow-right) <strong>prod</strong></span> &nbsp;<small>DEFER TO PROD</small>');
        assert.strictEqual(parts[1], 'Not built in dev, so read from prod.');
        assert.strictEqual(parts[3], '[Open prod table in BigQuery](https://example.com)');
    });

    test('uses only span styles a hover keeps', () => {
        const styles = [...hover.matchAll(/style="([^"]*)"/g)].map((match) => match[1]);
        assert.ok(styles.length >= 4);
        styles.forEach((style) => assert.match(style, KEPT_STYLE));
    });

    test('a table name makes no tag, emphasis or icon', () => {
        assert.strictEqual(hoverText('a_b*c<d>$(x)`e`'), 'a&#95;b&#42;c&#60;d&#62;&#36;(x)&#96;e&#96;');
    });

    test('a dev table alone, or one table for both, is listed without a diff', () => {
        const built = deferHoverMarkdown({ tone: 'dev', icon: 'check', heading: 'dev', sentence: 'Built in dev, so read from dev.', dev: 'acme-dev.sales.orders' });
        assert.match(built, /<code><span style="color:var\(--vscode-descriptionForeground\);">dev <\/span> acme-dev\.sales\.orders<\/code>$/);
        assert.doesNotMatch(built, /background-color/);
        const declared = deferHoverMarkdown({ tone: 'dev', icon: 'check', heading: 'declaration', sentence: 'A declaration.', table: 'acme.raw.orders' });
        assert.match(declared, />table<\/span> acme\.raw\.orders<\/code>$/);
    });
});
