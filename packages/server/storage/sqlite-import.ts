import type { Fs } from "webappwiz/system";
import type { SqliteDb } from "./sqlite-db";
import { decode } from "./sqlite-keys";

/**
 * Copies every file under `dir` into the database under `root`, each as the
 * kind of thing its name says: a `.jsonl` file as a log, one line an entry,
 * a `.jsonl` file in `log/` or a `<log>.segments/` directory as a segment of
 * that log, any other as a record or blob. Leaves out locks, stamps and
 * temporary files, which name the disk. Run again over what it copied, it
 * replaces it.
 */
export async function importTree(
	db: SqliteDb,
	fs: Fs,
	dir: string,
	root: string,
): Promise<void> {
	for (const file of await filesUnder(fs, dir, "")) {
		if (skipped(file)) {
			continue;
		}
		const bytes = await fs.readBytes(`${dir}/${file}`);
		const key = root === "" ? file : `${root}/${file}`;
		if (!file.endsWith(".jsonl")) {
			db.write(() => {
				db.db
					.query("INSERT OR REPLACE INTO kv (key, data, text) VALUES (?, ?, ?)")
					.run(key, bytes, BINARY.test(file) ? 0 : 1);
				return [key];
			});
			continue;
		}
		const segment = segmentLog(file);
		if (segment === null) {
			replaceLog(db, key, lines(bytes));
		} else {
			const log = root === "" ? segment : `${root}/${segment}`;
			replaceSegment(db, log, key, lines(bytes));
		}
	}
}

/** The files under `dir/rel`, as paths relative to `dir`, sorted. */
async function filesUnder(fs: Fs, dir: string, rel: string): Promise<string[]> {
	const found: string[] = [];
	for (const name of await fs.readdir(rel === "" ? dir : `${dir}/${rel}`)) {
		const path = rel === "" ? name : `${rel}/${name}`;
		if ((await fs.stat(`${dir}/${path}`)).isDirectory()) {
			found.push(...(await filesUnder(fs, dir, path)));
		} else {
			found.push(path);
		}
	}
	return found.sort();
}

/** Whether a file names the disk it sat on, so means nothing in a database. */
function skipped(file: string): boolean {
	return file
		.split("/")
		.some(
			(part) =>
				part.endsWith(".lock") || part === "format" || part.endsWith(".tmp"),
		);
}

/**
 * The log, relative to the root, that a file in a segments directory is a
 * segment of: the journal's `log/` holds those of `log.jsonl`, and every
 * other log's are in `<log>.segments/`. Null for a file that is no segment.
 */
function segmentLog(file: string): string | null {
	const dir = file.slice(0, file.lastIndexOf("/"));
	if (dir === "log") {
		return "log.jsonl";
	}
	return dir.endsWith(".segments") ? dir.slice(0, -".segments".length) : null;
}

const BINARY = /\.(png|gif|jpe?g|webp|mp4|webm|mov|pdf|zip|gz)$/i;

/** The whole lines of `bytes`, leaving out one a crash cut short. */
function lines(bytes: Uint8Array): string[] {
	const text = decode(bytes);
	const whole = text.slice(0, text.lastIndexOf("\n") + 1);
	return whole.split("\n").filter((line) => line !== "");
}

function replaceLog(db: SqliteDb, log: string, rows: string[]): void {
	db.write(() => {
		db.db
			.query("DELETE FROM entries WHERE log = ? AND segment IS NULL")
			.run(log);
		const insert = db.db.query(
			"INSERT INTO entries (log, segment, line) VALUES (?, NULL, ?)",
		);
		for (const line of rows) {
			insert.run(log, line);
		}
		return [log];
	});
}

/** A segment is keyed by the path of its file, as `Log.rotate` keys the ones it makes. */
function replaceSegment(
	db: SqliteDb,
	log: string,
	key: string,
	rows: string[],
): void {
	const name = key.slice(key.lastIndexOf("/") + 1);
	db.write(() => {
		db.db.query("DELETE FROM entries WHERE segment = ?").run(key);
		db.db.query("DELETE FROM segments WHERE key = ?").run(key);
		db.db
			.query("INSERT INTO segments (key, log, name, at) VALUES (?, ?, ?, ?)")
			.run(key, log, name, Number.parseInt(name, 10) || 0);
		const insert = db.db.query(
			"INSERT INTO entries (log, segment, line) VALUES (?, ?, ?)",
		);
		for (const line of rows) {
			insert.run(log, key, line);
		}
		return [key];
	});
}
