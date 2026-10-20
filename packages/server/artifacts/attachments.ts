import { basename, resolve } from "node:path";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Fs, Ps } from "webappwiz/system";
import { fail } from "../exit";
import type { Collection, Storage } from "../storage";

/** A file handed over, as bytes so a pasted image needs no temp file. */
export interface Attachment {
	/** What it was called, kept in the stored name so the files stay apart. */
	name: string;
	bytes: Uint8Array;
}

/**
 * The folder of files that belong to a task: a queued task's beside its
 * record, in `tasks/7/`, and a started task's in `tasks/7/started/`.
 * Under `.git/splates`, so nothing here is ever committed and every tree can
 * open what it holds.
 */
export class Attachments {
	private readonly files: Collection;
	/** Where the files can be opened, the path each is handed out by. */
	readonly dir: string;

	constructor(
		private readonly storage: Storage,
		private readonly key: string,
		private readonly ids: IdProvider = new UuidProvider(),
	) {
		this.files = storage.collection(key);
		this.dir = storage.locate(key);
	}

	/** Copies each file in, returning the absolute path each was stored at. */
	async store(files: Attachment[]): Promise<string[]> {
		const stored: string[] = [];
		for (const file of files) {
			const name = `${this.ids.next()}-${safe(file.name)}`;
			await this.files.writeBytes(name, file.bytes);
			stored.push(`${this.dir}/${name}`);
		}
		return stored;
	}

	/** Each file stored here, by absolute path, with its size in bytes. */
	async held(): Promise<{ path: string; bytes: number }[]> {
		return (await this.files.entries()).map(({ name, size }) => ({
			path: `${this.dir}/${name}`,
			bytes: size,
		}));
	}

	/** Whether `path` is one of this folder's files, and not a way out of it. */
	owns(path: string): boolean {
		return resolve(path).startsWith(`${resolve(this.dir)}/`);
	}

	/** Deletes the files given that are this folder's; others are left alone. */
	async remove(paths: string[]): Promise<void> {
		for (const path of paths.filter((path) => this.owns(path))) {
			await this.files.remove(basename(path));
		}
	}

	/** Deletes the folder and everything in it. */
	async clear(): Promise<void> {
		await this.storage.remove(this.key);
	}
}

/**
 * Reads files named on the command line, relative to the current directory or
 * absolute, refusing the whole command over one that cannot be read.
 */
export async function readFiles(
	{ fs, ps }: { fs: Fs; ps: Ps },
	paths: string[],
): Promise<Attachment[]> {
	const read: Attachment[] = [];
	for (const given of paths) {
		const path = resolve(ps.cwd(), given);
		const bytes = await fs.readBytes(path).catch(() => null);
		if (bytes === null) {
			fail("usage", `cannot read ${path}: nothing was changed`, {
				file: path,
			});
		}
		read.push({ name: basename(path), bytes });
	}
	return read;
}

/**
 * A stored name that survives being written into a one-line reply: paths are
 * separated by spaces there, so nothing in them may be one.
 */
function safe(name: string): string {
	return basename(name).replace(/[^\w.-]+/g, "-") || "attachment";
}
