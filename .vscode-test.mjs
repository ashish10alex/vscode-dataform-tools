import { defineConfig } from '@vscode/test-cli';

// VS Code's IPC socket path must stay under 103 characters, which a checkout in a deep directory (a git
// worktree, say) exceeds with the default user data dir. Point this at a short path to run the tests there.
const launchArgs = process.env.VSCODE_TEST_USER_DATA_DIR ? ['--user-data-dir', process.env.VSCODE_TEST_USER_DATA_DIR] : [];

export default defineConfig([
	{
		label: 'unit',
		files: 'out/src/test/**/*.test.js',
		launchArgs,
	},
	{
		// Recorded panel output: opens the test workspace and drives the real extension, see src/panelRecordings
		label: 'panel',
		files: 'out/src/panelRecordings/**/*.recording.js',
		workspaceFolder: 'src/test/test-workspace',
		launchArgs,
		mocha: { timeout: 2 * 60 * 1000 },
	},
	{
		// The extension in a dbt workspace: opens xf's example dbt Project, see src/dbtWorkspace
		label: 'dbt',
		files: 'out/src/dbtWorkspace/**/*.dbt.js',
		workspaceFolder: 'src/test/fixtures/xf-examples/projects/dbt',
		launchArgs,
		mocha: { timeout: 60 * 1000 },
	},
	{
		// `just bench`: opens the generated bench project, see src/bench
		label: 'bench',
		files: 'out/src/bench/**/*.bench.js',
		workspaceFolder: process.env.BENCH_WORKSPACE,
		launchArgs,
		mocha: { timeout: 30 * 60 * 1000 },
	},
]);
