import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		label: 'unit',
		files: 'out/src/test/**/*.test.js',
	},
	{
		// `just bench`: opens the generated bench project, see src/bench
		label: 'bench',
		files: 'out/src/bench/**/*.bench.js',
		workspaceFolder: process.env.BENCH_WORKSPACE,
		mocha: { timeout: 30 * 60 * 1000 },
	},
]);
