import * as assert from 'assert';
import { suite, test } from 'mocha';
import { columnNamesText, hasStatement, isScratchPath, tableNamesAt, runConfirmation, scanLevel, scratchFileName, scratchJobPlace, tableNamePrefix, tableNamesIn, tableNameText } from '../../scratch/scratchQuery';

const GIB = 1024 ** 3;
const names = (sql: string) => tableNamesIn(sql).map(tableNameText);

suite('scratchQuery.isScratchPath', () => {
    test('a .sql file directly in a Project\'s scratch folder is a scratch query', () => {
        assert.strictEqual(isScratchPath('/repo/.vscode-dataform-tools/tmp/scratch-2026-10-12-1432.sql'), true);
        assert.strictEqual(isScratchPath('C:\\repo\\.vscode-dataform-tools\\tmp\\orders.SQL'), true);
    });

    test('other files are not', () => {
        assert.strictEqual(isScratchPath('/repo/models/orders.sql'), false);
        assert.strictEqual(isScratchPath('/repo/.vscode-dataform-tools/tmp/notes.md'), false);
        assert.strictEqual(isScratchPath('/repo/.vscode-dataform-tools/tmp/deeper/orders.sql'), false);
        assert.strictEqual(isScratchPath('/repo/.vscode-dataform-tools/.sqlfluff'), false);
    });
});

suite('scratchQuery.scratchFileName', () => {
    const at = new Date(2026, 9, 12, 14, 32);

    test('is dated to the minute', () => {
        assert.strictEqual(scratchFileName(at), 'scratch-2026-10-12-1432.sql');
        assert.strictEqual(scratchFileName(new Date(2027, 0, 3, 9, 5)), 'scratch-2027-01-03-0905.sql');
    });

    test('a second one in the same minute is numbered', () => {
        assert.strictEqual(scratchFileName(at, ['scratch-2026-10-12-1432.sql', '.gitignore']), 'scratch-2026-10-12-1432-2.sql');
        assert.strictEqual(scratchFileName(at, ['scratch-2026-10-12-1432.sql', 'scratch-2026-10-12-1432-2.sql']), 'scratch-2026-10-12-1432-3.sql');
    });
});

suite('scratchQuery.scratchJobPlace', () => {
    test('the settings win for both Backends', () => {
        const settings = { gcpProjectId: ' billing ', gcpLocation: 'EU' };
        assert.deepStrictEqual(scratchJobPlace('dbt', ['analytics'], settings), { projectId: 'billing', location: 'EU' });
        assert.deepStrictEqual(scratchJobPlace('dataform', ['analytics'], settings), { projectId: 'billing', location: 'EU' });
    });

    test('a dbt Project\'s jobs run in the project most of its tables are in', () => {
        assert.deepStrictEqual(scratchJobPlace('dbt', ['raw', 'analytics', '', 'analytics'], {}), { projectId: 'analytics' });
        assert.deepStrictEqual(scratchJobPlace('dbt', [], {}), {});
    });

    test('a Dataform Project\'s jobs run in the credentials\' default project', () => {
        assert.deepStrictEqual(scratchJobPlace('dataform', ['analytics'], {}), {});
    });
});

suite('scratchQuery.scanLevel', () => {
    test('plain below 10 GiB, a warning from 10 to 50, and asked about above 50', () => {
        assert.strictEqual(scanLevel(9.9 * GIB, 10, 50), 'plain');
        assert.strictEqual(scanLevel(10 * GIB, 10, 50), 'warn');
        assert.strictEqual(scanLevel(50 * GIB, 10, 50), 'warn');
        assert.strictEqual(scanLevel(50.1 * GIB, 10, 50), 'confirm');
    });

    test('0 turns a step off', () => {
        assert.strictEqual(scanLevel(20 * GIB, 0, 50), 'plain');
        assert.strictEqual(scanLevel(900 * GIB, 10, 0), 'warn');
    });
});

suite('scratchQuery.runConfirmation', () => {
    test('a SELECT that scans little runs at once', () => {
        assert.strictEqual(runConfirmation({ statementType: 'SELECT', bytes: 2 * GIB }, 50), undefined);
    });

    test('a statement that changes data is asked about, by its type', () => {
        assert.strictEqual(runConfirmation({ statementType: 'DELETE', bytes: 0 }, 50), 'This is a DELETE statement, which changes data in BigQuery. Run it?');
        assert.ok(runConfirmation({ statementType: 'CREATE_TABLE_AS_SELECT', bytes: 0 }, 50)?.includes('CREATE TABLE AS SELECT statement'));
        assert.ok(runConfirmation({ statementType: 'SCRIPT', bytes: 0 }, 50)?.includes('script of several statements'));
    });

    test('a scan above the threshold is asked about, with what it costs', () => {
        assert.strictEqual(runConfirmation({ statementType: 'SELECT', bytes: 62 * GIB, cost: '$0.38' }, 50), 'This query will scan 62.00 GiB (~$0.38). Run it?');
    });

    test('both are asked about in one question', () => {
        const question = runConfirmation({ statementType: 'MERGE', bytes: 120 * GIB }, 50);
        assert.ok(question?.includes('MERGE statement') && question.includes('120.00 GiB'), question);
    });

    test('a query the dry run could not read is not asked about', () => {
        assert.strictEqual(runConfirmation({ bytes: 0 }, 50), undefined);
    });
});

suite('scratchQuery.hasStatement', () => {
    test('comments and space alone are nothing to run', () => {
        assert.strictEqual(hasStatement('-- Scratch query: plain BigQuery SQL.\n\n'), false);
        assert.strictEqual(hasStatement('/* notes */\n# more\n  '), false);
        assert.strictEqual(hasStatement(''), false);
    });

    test('a statement under a comment is', () => {
        assert.strictEqual(hasStatement('-- orders\nSELECT 1'), true);
    });
});

suite('scratchQuery.tableNamesIn', () => {
    test('reads names in backticks, however they are quoted', () => {
        assert.deepStrictEqual(names('SELECT * FROM `my-project.sales.orders` o JOIN `my-project`.`sales`.`customers` c ON TRUE'), ['my-project.sales.orders', 'my-project.sales.customers']);
        assert.deepStrictEqual(names('select * from `sales.orders`'), ['sales.orders']);
    });

    test('reads unquoted names after FROM and JOIN', () => {
        assert.deepStrictEqual(names('SELECT a FROM sales.orders o\nLEFT JOIN proj.sales.customers c USING (id)'), ['sales.orders', 'proj.sales.customers']);
    });

    test('leaves out CTEs, aliases with a column, and what is in comments and strings', () => {
        const sql = [
            'WITH recent AS (SELECT * FROM `p.d.orders`)',
            '-- FROM p.d.commented',
            "SELECT o.order_id, 'from p.d.quoted' FROM recent o /* join p.d.blocked */",
        ].join('\n');
        assert.deepStrictEqual(names(sql), ['p.d.orders']);
    });

    test('a table named twice is read once, and a query half-written is read as far as it goes', () => {
        assert.deepStrictEqual(names('SELECT  FROM `p.d.orders` WHERE x IN (SELECT y FROM `P.D.ORDERS`) AND'), ['P.D.ORDERS']);
        assert.deepStrictEqual(names('SELECT * FROM'), []);
    });
});

suite('scratchQuery.tableNamesAt', () => {
    test('says where each name is, backticks and all, in the order they are written', () => {
        const sql = 'SELECT *\nFROM `p.d.orders` o\nJOIN d.customers c USING (id)\nJOIN `p.d.orders` again USING (id)';
        const found = tableNamesAt(sql);
        assert.deepStrictEqual(found.map((each) => sql.slice(each.start, each.end)), ['`p.d.orders`', 'd.customers', '`p.d.orders`']);
        assert.deepStrictEqual(found[1].table, { datasetId: 'd', tableId: 'customers' });
    });

    test('a name in backticks after FROM is read once', () => {
        assert.strictEqual(tableNamesAt('SELECT 1 FROM `p.d.orders`').length, 1);
    });
});

suite('scratchQuery.columnNamesText', () => {
    test('is the names one to a line with commas between, in the table\'s order', () => {
        assert.strictEqual(columnNamesText([{ name: 'order_id' }, { name: 'order_date' }, { name: 'total' }]), 'order_id,\norder_date,\ntotal');
        assert.strictEqual(columnNamesText([{ name: 'order_id' }]), 'order_id');
        assert.strictEqual(columnNamesText([]), '');
    });
});

suite('scratchQuery.tableNamePrefix', () => {
    test('what is typed of a name starts at its backtick', () => {
        assert.deepStrictEqual(tableNamePrefix('SELECT * FROM `my-project.sal'), { text: '`my-project.sal', inTableName: true });
        assert.deepStrictEqual(tableNamePrefix('FROM sales.ord'), { text: 'sales.ord', inTableName: true });
    });

    test('a word alone may be a column or a table', () => {
        assert.deepStrictEqual(tableNamePrefix('SELECT ord'), { text: 'ord', inTableName: false });
        assert.deepStrictEqual(tableNamePrefix('SELECT '), { text: '', inTableName: false });
    });
});
