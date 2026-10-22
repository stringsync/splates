import { dirname } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Lock, Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { fail } from "../exit";
import type { Format } from "./format";

/**
 * Moves one repository's records to this splates's format so a failure leaves
 * them as they were: backed up first, the steps run in a child that is
 * killed past the limit, and the backup put back when it fails, with why
 * kept beside the records. A failure kept for this release refuses each
 * later try until `retry` asks again, so a server started over and over
 * never runs a broken step over and over.
 */
export class Migration {
	private readonly fs: Fs;
	private readonly log: Logger;
	private readonly lock: Lock;
	private readonly release: string;
	private readonly child: MigrationOptions["child"];
	private readonly limit: Duration;
	private readonly settle: MigrationOptions["settle"];
	/** Where the failure is kept: beside the records, since a restore replaces them. */
	readonly failurePath: string;
	readonly backupPath: string;

	constructor(
		readonly format: Format,
		{
			fs,
			log,
			lock,
			release,
			child,
			limit = MIGRATION_LIMIT,
			settle,
		}: MigrationOptions,
	) {
		this.settle = settle;
		this.fs = fs;
		this.log = log;
		this.lock = lock;
		this.release = release;
		this.child = child;
		this.limit = limit;
		this.failurePath = `${format.splatesDir}-migration.json`;
		this.backupPath = `${format.splatesDir}-backup`;
	}

	/** The child `splates migrate` this process would run, in `root`. */
	static childOf(
		ps: Ps,
		root: string,
	): (signal: AbortSignal) => Promise<{ exitCode: number; stderr: string }> {
		return async (signal) => {
			try {
				const { exitCode, stderr } = await ps.spawnCapture(
					[...ps.self, "migrate"],
					{ cwd: root, env: { [MIGRATING]: "1" }, signal },
				);
				return { exitCode, stderr };
			} catch (error) {
				if (signal.aborted) {
					return { exitCode: 128 + 15, stderr: "" };
				}
				throw error;
			}
		};
	}

	/** The failure kept for these records, or null for none. */
	async failure(): Promise<MigrationFailure | null> {
		const raw = await this.fs.read(this.failurePath).catch(() => null);
		if (raw === null) {
			return null;
		}
		const parsed = MigrationFailure.safeParse(
			(() => {
				try {
					return JSON.parse(raw);
				} catch {
					return null;
				}
			})(),
		);
		return parsed.success ? parsed.data : null;
	}

	/**
	 * Moves the records forward, then checks them as `Format.check` does.
	 * Refuses them as `migration_failed` when a step fails, runs past the
	 * limit, or failed before on this release, unless `retry`.
	 */
	async run({ retry = false }: { retry?: boolean } = {}): Promise<void> {
		if (!(await this.format.pending())) {
			await this.fs.rm(this.failurePath, { force: true });
			await this.format.check();
			return this.settle?.();
		}
		const kept = await this.failure();
		if (kept !== null && kept.release === this.release && !retry) {
			this.refuse(kept);
		}
		await this.lock.acquire();
		let failed: MigrationFailure | null = null;
		try {
			// Read again under the lock: another may have just migrated.
			const from = await this.format.stored();
			if (from !== null && from < this.format.current) {
				failed = await this.migrate(from);
			}
		} finally {
			await this.lock.release();
		}
		if (failed !== null) {
			this.refuse(failed);
		}
		await this.format.check();
		await this.settle?.();
	}

	/** Forgets a kept failure, so the next `run` tries again. */
	async forget(): Promise<void> {
		await this.fs.rm(this.failurePath, { force: true });
	}

	private async migrate(from: number): Promise<MigrationFailure | null> {
		const { splatesDir } = this.format;
		await this.fs.rm(this.backupPath, { recursive: true, force: true });
		await copyTree(this.fs, splatesDir, this.backupPath);
		this.log.info(
			`migrating the splates records in ${dirname(dirname(splatesDir))} from format ${from} to ${this.format.current}`,
		);
		const signal = AbortSignal.timeout(this.limit.ms);
		const { exitCode, stderr } = await this.child(signal).catch(
			(error: unknown) => ({ exitCode: 1, stderr: String(error) }),
		);
		if (exitCode === 0 && !signal.aborted) {
			await this.fs.rm(this.failurePath, { force: true });
			await this.fs.rm(this.backupPath, { recursive: true, force: true });
			return null;
		}
		// The step it stopped on is the one after the last stamped.
		const reached = await this.format.stored().catch(() => from);
		const step = this.format.stepAfter(reached ?? from);
		await this.fs.rm(splatesDir, { recursive: true, force: true });
		await copyTree(this.fs, this.backupPath, splatesDir);
		await this.fs.rm(this.backupPath, { recursive: true, force: true });
		const said = color.strip(stderr).trim();
		const failure: MigrationFailure = {
			from,
			to: this.format.current,
			step,
			error: signal.aborted
				? `still running after ${this.limit.human()}, so it was stopped${said === "" ? "" : `:\n${said}`}`
				: said === ""
					? `exited ${exitCode} without saying why`
					: said.slice(-4000),
			release: this.release,
			fallback:
				LAST_READ[from] === undefined || LAST_READ[from] === this.release
					? null
					: LAST_READ[from],
			at: new Date().toISOString(),
		};
		await this.fs.mkdir(dirname(this.failurePath), { recursive: true });
		await this.fs.write(
			this.failurePath,
			`${JSON.stringify(failure, null, "\t")}\n`,
		);
		this.log.error(
			`could not migrate the splates records in ${dirname(dirname(splatesDir))}: ${failure.error}`,
		);
		return failure;
	}

	private refuse(failure: MigrationFailure): never {
		fail(
			"migration_failed",
			[
				`this repository's splates records could not move from format ${failure.from} to ${failure.to}${failure.step === null ? "" : ` (${failure.step})`}, so they were put back as they were: ${failure.error}`,
				failure.fallback === null
					? "Fix what stopped it, then run `splates migrate` in this repository to try again."
					: `Fix what stopped it, then run \`splates migrate\` in this repository to try again; meanwhile \`bunx @stringsync/splates@${failure.fallback}\` reads them as they are.`,
			].join("\n"),
			failure,
		);
	}
}

/**
 * Set in the environment of the `splates migrate` a `Migration` runs, so that
 * one runs the steps itself rather than guarding another.
 */
export const MIGRATING = "SPLATES_MIGRATING";

/** How long one repository's steps may run before they count as stuck. */
export const MIGRATION_LIMIT = Duration.mins(5);

/**
 * The last published splates that reads each format, by format: where a
 * person goes back to while a migration from it fails. A format with none
 * was never published.
 */
export const LAST_READ: Readonly<Record<number, string>> = { 1: "0.0.47" };

/** Why a repository's records stayed where they were, as kept beside them. */
export const MigrationFailure = z.object({
	/** The format the records are in, restored from the backup. */
	from: z.number(),
	/** The format this splates reads. */
	to: z.number(),
	/** What the step that failed changes, or null when the child died first. */
	step: z.string().nullable(),
	/** What went wrong, as the child said it. */
	error: z.string(),
	/** The splates that tried; another tries again on its own. */
	release: z.string(),
	/** The last published splates that reads `from`, or null for none. */
	fallback: z.string().nullable(),
	/** When it failed, in ISO 8601. */
	at: z.string(),
});
export type MigrationFailure = z.infer<typeof MigrationFailure>;

/** What a `Migration` works with. */
export interface MigrationOptions {
	fs: Fs;
	log: Logger;
	/** Held around the backup, the steps and any restore. */
	lock: Lock;
	/** The splates running, which a failure is kept against. */
	release: string;
	/**
	 * Runs the steps in a child, `splates migrate` with `MIGRATING` set,
	 * killed once `signal` aborts; answers with its exit code and what it
	 * said on stderr.
	 */
	child(signal: AbortSignal): Promise<{ exitCode: number; stderr: string }>;
	limit?: Duration;
	/**
	 * Runs once the records are in this splates's format, whether it moved
	 * them or found them so: clears what the steps left behind.
	 */
	settle?: () => Promise<void>;
}

/** Copies `from` to `to`, a file or a tree, leaving out locks, which name this machine's processes. */
async function copyTree(fs: Fs, from: string, to: string): Promise<void> {
	if (from.endsWith(".lock") || !(await fs.exists(from))) {
		return;
	}
	if ((await fs.stat(from)).isDirectory()) {
		await fs.mkdir(to, { recursive: true });
		for (const each of await fs.readdir(from)) {
			await copyTree(fs, `${from}/${each}`, `${to}/${each}`);
		}
		return;
	}
	await fs.writeBytes(to, await fs.readBytes(from));
}
