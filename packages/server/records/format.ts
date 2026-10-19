import type { Logger } from "webappwiz/log";
import type { Fs, Lock } from "webappwiz/system";
import { fail } from "../exit";
import { ONE_TASK_STORE } from "./one-task-store";
import { TASK_FILES } from "./task-files";
import { TASK_STAGES } from "./task-stages";

/**
 * One step forward in the format of the records under `.git/splates`: from the
 * version before it to its own. A step can be interrupted and run again, and
 * finds no records to change in a repository that has none yet.
 */
export interface Migration {
	/** What the step changes, said as it runs: "moves lanes into their own files". */
	does: string;
	run(splatesDir: string, fs: Fs): Promise<void>;
}

/**
 * Every step from version 1, in order: the one at index 0 takes records from
 * version 1 to 2. Forward only; splates never writes an older format.
 */
export const MIGRATIONS: readonly Migration[] = [
	ONE_TASK_STORE,
	TASK_FILES,
	TASK_STAGES,
];

/**
 * The version of the records under `.git/splates` this splates reads and writes:
 * tasks, lanes, the journal and conversations, as one. A change an
 * older splates would misread adds a step to `MIGRATIONS`, which moves it on.
 */
export const FORMAT = MIGRATIONS.length + 1;

/** What a `Format` works with. */
export interface FormatOptions {
	fs: Fs;
	/** Held while migrating, so two commands never run the same step at once. */
	lock: Lock;
	log: Logger;
	/** The steps from version 1; a test passes its own. */
	migrations?: readonly Migration[];
}

/** The format of one repository's records, kept in `<splatesDir>/format`. */
export class Format {
	private readonly fs: Fs;
	private readonly lock: Lock;
	private readonly log: Logger;
	private readonly migrations: readonly Migration[];
	private readonly path: string;

	constructor(
		readonly splatesDir: string,
		{ fs, lock, log, migrations = MIGRATIONS }: FormatOptions,
	) {
		this.fs = fs;
		this.lock = lock;
		this.log = log;
		this.migrations = migrations;
		this.path = `${splatesDir}/format`;
	}

	/** The version this splates reads and writes. */
	get current(): number {
		return this.migrations.length + 1;
	}

	/**
	 * Makes the repository a splates project, as only `splates init` does: stamps
	 * records from before formats were stamped as version 1, and a repository
	 * with none yet as this splates's. Leaves stamped records alone.
	 */
	async create(): Promise<void> {
		if ((await this.stored()) !== null) {
			return;
		}
		const records = await this.fs.exists(this.splatesDir);
		await this.fs.mkdir(this.splatesDir);
		await this.write(records ? 1 : this.current);
	}

	/**
	 * Refuses records in any format but this splates's, which it would misread or
	 * overwrite: a newer one until splates is updated, an older one until
	 * `splates server` has migrated it. Refuses a repository with none stamped
	 * until `splates init` has made it a splates project.
	 */
	async check(): Promise<void> {
		const stored = await this.stored();
		if (stored === this.current) {
			return;
		}
		if (stored === null) {
			fail(
				"uninitialized",
				[
					"this repository is not a splates project yet.",
					"Run `splates init` in it once: it sets up splates's records and registers it, then every command works.",
				].join("\n"),
			);
		}
		fail(
			"outdated",
			[
				`this repository's splates records are in format ${stored}, older than this splates's ${this.current}, so it leaves them alone.`,
				"Start `splates server` in this repository once: it migrates them, then every command works as before.",
			].join("\n"),
			{ format: stored, understood: this.current },
		);
	}

	/**
	 * Moves older records forward to this splates's format, a step at a time,
	 * then checks them as `check` does.
	 */
	async migrate(): Promise<void> {
		const stored = await this.stored();
		if (stored === null || stored === this.current) {
			return this.check();
		}
		// Read again under the lock: another command may have just migrated.
		await this.lock.acquire();
		try {
			for (
				let format = (await this.stored()) ?? this.current;
				format < this.current;
				format += 1
			) {
				const step = this.migrations[format - 1] as Migration;
				this.log.info(
					`migrating splates's records to format ${format + 1}: ${step.does}`,
				);
				await step.run(this.splatesDir, this.fs);
				// After each step, so one cut short starts again from there.
				await this.write(format + 1);
			}
		} finally {
			await this.lock.release();
		}
		await this.check();
	}

	/**
	 * The stored version, or null for records from before formats were
	 * stamped, which are version 1. Refuses one this splates cannot read.
	 */
	private async stored(): Promise<number | null> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return null;
		}
		const format = Number(raw.trim());
		if (!Number.isInteger(format) || format < 1) {
			fail("usage", `${this.path} names no format: '${raw.trim()}'`, {
				format: raw,
			});
		}
		if (format > this.current) {
			fail(
				"outdated",
				[
					`this repository's splates records are in format ${format}, written by a newer splates; this one understands up to ${this.current}, so it leaves them alone.`,
					"Run `bunx @stringsync/splates@latest` instead.",
				].join("\n"),
				{ format, understood: this.current },
			);
		}
		return format;
	}

	private async write(format: number): Promise<void> {
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${format}\n`);
		await this.fs.rename(tmp, this.path);
	}
}
