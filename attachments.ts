import { basename, resolve } from "node:path";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Fs, Ps } from "webappwiz/system";
import { fail } from "./exit";

/** A file handed over, as bytes so a pasted image needs no temp file. */
export interface Attachment {
	/** What it was called, kept in the stored name so the files stay apart. */
	name: string;
	bytes: Uint8Array;
}

/**
 * The folder of files that belong to a todo: todo 7's beside its record, in
 * `todos/7/`.
 * Under `.git/arbor`, so nothing here is ever committed and every tree can
 * open what it holds.
 */
export class Attachments {
	constructor(
		readonly dir: string,
		private readonly fs: Fs,
		private readonly ids: IdProvider = new UuidProvider(),
	) {}

	/** Copies each file in, returning the absolute path each was stored at. */
	async store(files: Attachment[]): Promise<string[]> {
		if (files.length === 0) {
			return [];
		}
		await this.fs.mkdir(this.dir);
		const stored: string[] = [];
		for (const file of files) {
			const path = `${this.dir}/${this.ids.next()}-${safe(file.name)}`;
			await this.fs.writeBytes(path, file.bytes);
			stored.push(path);
		}
		return stored;
	}

	/** Whether `path` is one of this folder's files, and not a way out of it. */
	owns(path: string): boolean {
		return resolve(path).startsWith(`${resolve(this.dir)}/`);
	}

	/** Deletes the files given that are this folder's; others are left alone. */
	async remove(paths: string[]): Promise<void> {
		for (const path of paths.filter((path) => this.owns(path))) {
			await this.fs.rm(path, { force: true });
		}
	}

	/** Deletes the folder and everything in it. */
	async clear(): Promise<void> {
		await this.fs.rm(this.dir, { recursive: true, force: true });
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
