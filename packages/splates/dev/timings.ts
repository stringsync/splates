import { join } from "node:path";
import type { Fs } from "webappwiz/system";

/**
 * The per-file test durations of each half's last passing gate, for bun's
 * `--timings` to start the slowest files first. `forRun` gives a run its
 * arguments; a missing or unreadable file costs only the order, never the run.
 */
// Kept in the repository's common git dir, which outlives every worktree,
// one file per half since the two run side by side and each writes its own.
// Only a gate's whole run that passed writes it, so a failing or partial run
// never skews it.
export class TestTimings {
	constructor(
		private readonly fs: Fs,
		/** The repository's common git dir. */
		private readonly gitDir: string,
	) {}

	/** Where the timings of `half` are kept. */
	path(half: string): string {
		return join(this.gitDir, `splates-test-timings-${half}.json`);
	}

	/**
	 * The arguments that order a run of `half` by its kept timings and, when
	 * `scratch` is given, measure them afresh into a copy there, which
	 * `kept` puts in place of the kept file once the run has passed.
	 */
	async forRun(
		half: string,
		scratch?: string,
	): Promise<{ args: string[]; kept: (passed: boolean) => Promise<void> }> {
		const path = this.path(half);
		const known = await this.readable(path);
		if (scratch === undefined) {
			return {
				args: known === null ? [] : [`--timings=${path}`],
				kept: async () => {},
			};
		}
		const copy = join(scratch, `timings-${half}.json`);
		if (known !== null) {
			await this.fs.write(copy, known);
		}
		return {
			args: [`--timings=${copy}`, "--update-timings"],
			kept: async (passed) => {
				const measured = passed ? await this.readable(copy) : null;
				if (measured === null) {
					return;
				}
				// Renamed into place, so a run beside it never reads half a file.
				const next = `${path}.${process.pid}.next`;
				await this.fs.write(next, measured);
				await this.fs.rename(next, path);
			},
		};
	}

	/** The file's text when it holds timings bun can read, else null. */
	private async readable(path: string): Promise<string | null> {
		const text = await this.fs.read(path).catch(() => null);
		if (text === null) {
			return null;
		}
		try {
			const parsed: unknown = JSON.parse(text);
			return typeof parsed === "object" &&
				parsed !== null &&
				"files" in parsed &&
				typeof parsed.files === "object" &&
				parsed.files !== null
				? text
				: null;
		} catch {
			return null;
		}
	}
}
