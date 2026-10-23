/** Catch a refused cloud job to report why no runner is available and what the caller can do next. */
export class NoRunner extends Error {
	constructor(message: string) {
		super(
			`${message}. Run a small selection directly (\`bun test --changed\` or test-file paths), or wait for a runner; leave the whole suite to the merge gate.`,
		);
	}
}
