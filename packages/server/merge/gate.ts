import type { Fs, HeavyCap } from "webappwiz/system";
import type { Config } from "../config";
import type { Git } from "../git";
import type { Shell } from "../terminal";

/** A hook's output and its fresh JUnit report, kept together for attribution. */
export interface GateRun {
	exitCode: number;
	stdout: string;
	stderr: string;
	xml: string;
}

/** Runs merge checks in the machine's heavy-job slots, including isolated retests. */
export class MergeGate {
	constructor(
		private readonly git: Git,
		private readonly shell: Shell,
		private readonly fs: Fs,
		private readonly heavy: HeavyCap,
		private readonly config: Config,
	) {}

	get command(): string {
		return [this.config.postRewrite, this.config.preMerge]
			.filter(Boolean)
			.join(" && ");
	}

	async run(
		cwd: string,
		task: string,
		{ files }: { files?: string[] } = {},
	): Promise<GateRun> {
		try {
			const report = `${(await this.git.out(cwd, "rev-parse", "--absolute-git-dir")).trim()}/splates-test-report.xml`;
			await this.fs.rm(report, { force: true });
			const command =
				files === undefined
					? this.command
					: [
							"bun test --timeout 30000 --reporter=junit",
							`--reporter-outfile=${quoted(report)}`,
							...files.map((file) => quoted(`./${file}`)),
						].join(" ");
			if (!command) {
				return { exitCode: 0, stdout: "", stderr: "", xml: "" };
			}
			await using slot = await this.heavy.take({ what: "preMerge", task });
			const run = await this.shell.run(command, cwd, {
				env: {
					SPLATES_TASK: task,
					SPLATES_WORKTREE: cwd,
					SPLATES_TEST_REPORT: report,
					...slot.env,
				},
				...(files === undefined ? {} : { timeoutMs: 180_000 }),
			});
			return { ...run, xml: await this.fs.read(report).catch(() => "") };
		} catch (error) {
			return { exitCode: 1, stdout: "", stderr: String(error), xml: "" };
		}
	}

	/** The baseline needs its own dependencies, never the task's node_modules. */
	async prepare(cwd: string, task: string): Promise<GateRun> {
		if (!this.config.postRewrite) {
			return { exitCode: 0, stdout: "", stderr: "", xml: "" };
		}
		await using slot = await this.heavy.take({
			what: "preMerge attribution setup",
			task,
		});
		const run = await this.shell.run(this.config.postRewrite, cwd, {
			env: { SPLATES_TASK: task, SPLATES_WORKTREE: cwd, ...slot.env },
			timeoutMs: 180_000,
		});
		return { ...run, xml: "" };
	}
}

function quoted(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}
