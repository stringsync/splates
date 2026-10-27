import { join } from "node:path";
import type { Fs } from "webappwiz/system";

/**
 * Orders a test run's files slowest first, by the per-file durations of each
 * half's last passing gate. `forRun` gives a run its bun arguments; missing or
 * unreadable timings cost only the order, never the run.
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
	 * `kept` puts in place of the kept file once the run has passed. The
	 * entries of the `skipped` files, which the run left out, stay as they were.
	 */
	async forRun(
		half: string,
		scratch?: string,
		skipped: string[] = [],
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
				const read = passed ? await this.readable(copy) : null;
				if (read === null) {
					return;
				}
				const measured = this.withSkipped(read, known, skipped);
				// Renamed into place, so a run beside it never reads half a file.
				const next = `${path}.${process.pid}.next`;
				await this.fs.write(next, measured);
				await this.fs.rename(next, path);
			},
		};
	}

	/** `measured` with the entries `known` has for the `skipped` files it lacks. */
	private withSkipped(
		measured: string,
		known: string | null,
		skipped: string[],
	): string {
		if (known === null || skipped.length === 0) {
			return measured;
		}
		const now = JSON.parse(measured) as { files: Record<string, unknown> };
		const before = JSON.parse(known) as { files: Record<string, unknown> };
		for (const [file, entry] of Object.entries(before.files)) {
			const left = skipped.some(
				(name) => file === name || file.endsWith(`/${name}`),
			);
			if (left && !(file in now.files)) {
				now.files[file] = entry;
			}
		}
		return JSON.stringify(now);
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
