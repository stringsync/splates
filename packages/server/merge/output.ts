import type { Fs, OutputWatcher } from "webappwiz/system";

/**
 * A merge step's command output, appended to the file at `path` as it
 * prints, for the page to follow while the step runs. Starts the file
 * afresh; a write that fails only leaves the page short of output, never the
 * merge.
 */
export class OutputFile implements AsyncDisposable {
	private writing: Promise<void>;

	constructor(
		private readonly fs: Fs,
		private readonly path: string,
	) {
		this.writing = fs.write(path, "").catch(() => {});
	}

	/** What the command's spawn hands each chunk to, in the order it came. */
	readonly watcher: OutputWatcher = {
		stdout: (chunk) => this.append(chunk),
		stderr: (chunk) => this.append(chunk),
	};

	private append(chunk: string): void {
		this.writing = this.writing
			.then(() => this.fs.append(this.path, chunk))
			.catch(() => {});
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.writing;
	}
}

/** Where `step`, the merge's `index`th, keeps its output, in the task's git directory. */
export function outputPath(
	gitDir: string,
	index: number,
	step: string,
): string {
	return `${gitDir}/splates-merge-${index}-${step}.log`;
}
