/** Catch a refused cloud job to report why no runner is available and what the caller can do next. */
export class NoRunner extends Error {
	constructor(message: string) {
		super(
			`${message}. Run a test file or two directly (\`bun test <path>\`), or wait for a runner; leave the whole suite to the merge gate.`,
		);
	}
}
