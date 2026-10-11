import type { Logger } from "webappwiz/log";
import type { Fs, Lock } from "webappwiz/system";
import { fail } from "./exit";

/**
 * One step forward in the format of the records under `.git/arbor`: from the
 * version before it to its own. A step can be interrupted and run again, and
 * finds no records to change in a repository that has none yet.
 */
export interface Migration {
	/** What the step changes, said as it runs: "moves lanes into their own files". */
	does: string;
	run(arborDir: string, fs: Fs): Promise<void>;
}

/**
 * Every step from version 1, in order: the one at index 0 takes records from
 * version 1 to 2. Forward only; arbor never writes an older format.
 */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * The version of the records under `.git/arbor` this arbor reads and writes:
 * tasks, todos, lanes, the journal and conversations, as one. A change an
 * older arbor would misread adds a step to `MIGRATIONS`, which moves it on.
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

/** The format of one repository's records, kept in `<arborDir>/format`. */
export class Format {
	private readonly fs: Fs;
	private readonly lock: Lock;
	private readonly log: Logger;
	private readonly migrations: readonly Migration[];
	private readonly path: string;

	constructor(
		readonly arborDir: string,
		{ fs, lock, log, migrations = MIGRATIONS }: FormatOptions,
	) {
		this.fs = fs;
		this.lock = lock;
		this.log = log;
		this.migrations = migrations;
		this.path = `${arborDir}/format`;
	}

	/** The version this arbor reads and writes. */
	get current(): number {
		return this.migrations.length + 1;
	}

	/**
	 * Makes the repository an arbor project, as only `arbor init` does: stamps
	 * records from before formats were stamped as version 1, and a repository
	 * with none yet as this arbor's. Leaves stamped records alone.
	 */
	async create(): Promise<void> {
		if ((await this.stored()) !== null) {
			return;
		}
		const records = await this.fs.exists(this.arborDir);
		await this.fs.mkdir(this.arborDir);
		await this.write(records ? 1 : this.current);
	}

	/**
	 * Refuses records in any format but this arbor's, which it would misread or
	 * overwrite: a newer one until arbor is updated, an older one until
	 * `arbor dev` has migrated it. Refuses a repository with none stamped
	 * until `arbor init` has made it an arbor project.
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
					"this repository is not an arbor project yet.",
					"Run `arbor init` in it once: it sets up arbor's records and registers it, then every command works.",
				].join("\n"),
			);
		}
		fail(
			"outdated",
			[
				`this repository's arbor records are in format ${stored}, older than this arbor's ${this.current}, so it leaves them alone.`,
				"Start `arbor dev` in this repository once: it migrates them, then every command works as before.",
			].join("\n"),
			{ format: stored, understood: this.current },
		);
	}

	/**
	 * Moves older records forward to this arbor's format, a step at a time,
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
					`migrating arbor's records to format ${format + 1}: ${step.does}`,
				);
				await step.run(this.arborDir, this.fs);
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
	 * stamped, which are version 1. Refuses one this arbor cannot read.
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
					`this repository's arbor records are in format ${format}, written by a newer arbor; this one understands up to ${this.current}, so it leaves them alone.`,
					"Run `bunx @webappwiz/arbor@latest` instead.",
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
