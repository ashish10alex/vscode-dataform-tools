import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { CompileStatus, FileSlice } from '../../shared/panelContract';
import { applyMessage, initialSlices } from '../../shared/panelState';
import { CompilationErrorType } from '../../types';
import { isCompiling, panelProblem } from '../../../webviews/preview_compiled/utils/panelProblem';

const status = (value: object): CompileStatus => ({ compile: 1, ...value } as CompileStatus);
const file = (value: Partial<FileSlice> = {}): FileSlice => ({ compile: 1, file: 'definitions/a.sqlx', role: 'not compiled', actions: [], ...value });
const compiled = status({ status: 'compiled', compiledAt: 1, errors: [] });
const compiling = status({ status: 'compiling', showingPrevious: false, startedAt: 1 });
const errors = [{ message: 'Unexpected token', fileName: 'definitions/a.sqlx', line: 10 }];
const failed = status({ status: 'failed', errors });
/** The slices after the host's messages, as the panel keeps them */
const after = (...messages: Array<CompileStatus | FileSlice>) =>
    messages.reduce((slices, value) => applyMessage(slices, 'status' in value ? { slice: 'compile status', value } : { slice: 'file', value }), initialSlices());

suite('panel: what is wrong, from the compile status and the file slice', () => {
    test('before the host has said anything, and for a file with something to show, nothing is wrong', () => {
        assert.deepStrictEqual(panelProblem(initialSlices()), { compiling: false, type: null, message: null, compileErrors: [], missingTools: [] });
        for (const role of ['actions', 'helper', 'project settings'] as const) {
            assert.strictEqual(panelProblem(after(compiled, file({ role }))).type, null, role);
        }
    });

    test('a file names its own problem', () => {
        const of = (problem: FileSlice['problem']) => { const found = panelProblem(after(compiled, file({ problem }))); return [found.type, found.message]; };
        assert.deepStrictEqual(of({ kind: 'unsupported file type', message: 'File type not supported' }), [CompilationErrorType.UNSUPPORTED_FILE_TYPE, 'File type not supported']);
        assert.deepStrictEqual(of({ kind: 'no action' }), [CompilationErrorType.FILE_NOT_FOUND, null]);
        assert.deepStrictEqual(of({ kind: 'no sql', message: 'Query could not be determined' }), [CompilationErrorType.QUERY_META_ERROR, 'Query could not be determined']);
        assert.deepStrictEqual(of({ kind: 'other', message: 'Unable to retrieve metadata' }), [CompilationErrorType.COMPILATION_ERROR, 'Unable to retrieve metadata']);
    });

    test('with nothing to show and no problem of the file, the compile says why', () => {
        const missing = panelProblem(after(status({ status: 'tool not found', tool: 'dataform', lookedIn: [] }), file()));
        assert.deepStrictEqual([missing.type, missing.missingTools, missing.message], [CompilationErrorType.MISSING_EXECUTABLE, ['dataform'], null]);
        const outside = panelProblem(after(status({ status: 'no project' }), file({ file: '' })));
        assert.strictEqual(outside.type, CompilationErrorType.NOT_A_DATAFORM_WORKSPACE);
        assert.ok(outside.message?.startsWith('This file is not in a Dataform or dbt project'));
        const broken = panelProblem(after(failed, file()));
        assert.deepStrictEqual([broken.type, broken.message, broken.compileErrors], [CompilationErrorType.COMPILATION_ERROR, null, errors]);
        // A compile that left a graph and errors, and a file that has something to show: the file is shown
        assert.strictEqual(panelProblem(after(status({ status: 'compiled', compiledAt: 1, errors }), file({ role: 'actions' }))).type, null);
    });

    test('while a compile runs, what was wrong before it started still is, and nothing is said of it', () => {
        const again = after(failed, file(), compiling);
        assert.strictEqual(isCompiling(again), true);
        const problem = panelProblem(again);
        // The type stays, so that what it hides stays hidden; the errors and the message are of a compile that is being redone
        assert.deepStrictEqual([problem.compiling, problem.type, problem.compileErrors, problem.message], [true, CompilationErrorType.COMPILATION_ERROR, [], null]);
        const outside = panelProblem(after(status({ status: 'no project' }), file({ file: '' }), compiling));
        assert.deepStrictEqual([outside.type, outside.message], [CompilationErrorType.NOT_A_DATAFORM_WORKSPACE, null]);
        const ofTheFile = panelProblem(after(compiled, file({ problem: { kind: 'other', message: 'Unable to retrieve metadata' } }), compiling));
        assert.deepStrictEqual([ofTheFile.type, ofTheFile.message], [CompilationErrorType.COMPILATION_ERROR, null]);
        // The first compile of all: nothing was wrong before it
        assert.strictEqual(panelProblem(after(compiling)).type, null);
    });

    test('a tool that was missing and is found is no longer missing', () => {
        const missing = status({ status: 'tool not found', tool: 'dataform', lookedIn: [] });
        assert.deepStrictEqual(panelProblem(after(missing, file(), compiling)).missingTools, ['dataform']);
        const found = panelProblem(after(missing, file(), compiling, compiled, file({ role: 'actions' })));
        assert.deepStrictEqual([found.type, found.missingTools], [null, []]);
    });

    test('the first page says how the compile stands', () => {
        const missing = initialSlices({ compile: status({ status: 'tool not found', tool: 'dataform', lookedIn: [] }) });
        assert.deepStrictEqual([panelProblem(missing).type, panelProblem(missing).missingTools], [CompilationErrorType.MISSING_EXECUTABLE, ['dataform']]);
        // It is kept as the last compile that finished, for the compile that follows
        assert.strictEqual(missing.settled, missing.compile);
        assert.strictEqual(initialSlices({ compile: compiling }).settled, undefined);
        assert.strictEqual(panelProblem(initialSlices({ compile: compiling })).compiling, true);
    });
});
