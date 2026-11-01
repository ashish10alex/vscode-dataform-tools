import * as assert from 'assert';
import { suite, test } from 'mocha';
import { cleanProdProject, joinProdOptions, splitProdProject } from '../../shared/prodOptions';

suite('prodOptions', () => {
    test('splits the prod project from the other options', () => {
        assert.deepStrictEqual(splitProdProject('--default-database=acme-prod --vars=env=prod'), { project: 'acme-prod', rest: '--vars=env=prod' });
        assert.deepStrictEqual(splitProdProject('--vars="a=1 b=2" --default-database="acme-prod"'), { project: 'acme-prod', rest: '--vars="a=1 b=2"' });
        assert.deepStrictEqual(splitProdProject('--vars=env=prod'), { project: '', rest: '--vars=env=prod' });
        assert.deepStrictEqual(splitProdProject(undefined), { project: '', rest: '' });
    });

    test('takes a pasted flag or stray quotes and spaces as the project ID', () => {
        assert.strictEqual(cleanProdProject(' --default-database=acme-prod '), 'acme-prod');
        assert.strictEqual(cleanProdProject('"acme-prod"'), 'acme-prod');
        assert.strictEqual(cleanProdProject('acme prod'), 'acmeprod');
    });

    test('joins the prod project and the other options, and drops the flag for an empty project', () => {
        assert.strictEqual(joinProdOptions('acme-prod', '--vars=env=prod'), '--default-database=acme-prod --vars=env=prod');
        assert.strictEqual(joinProdOptions('', '--vars=env=prod'), '--vars=env=prod');
        assert.strictEqual(joinProdOptions(' ', ' '), '');
        const { project, rest } = splitProdProject('--vars=env=prod --default-database=old');
        assert.strictEqual(joinProdOptions('new', rest), '--default-database=new --vars=env=prod');
        assert.strictEqual(joinProdOptions(project, rest), '--default-database=old --vars=env=prod');
    });
});
