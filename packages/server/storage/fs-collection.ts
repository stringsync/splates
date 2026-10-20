import type { Fs } from "webappwiz/system";
import { readIfThere, replace } from "./atomic";
import type { Collection, CollectionEntry } from "./collection";
import { checkName } from "./key";

/**
 * A collection kept as a directory, a file per name. Directories in it, as a
 * task's folder of attachments beside its record, are another collection's
 * and left out.
 */
export class FsCollection implements Collection {
	constructor(
		readonly key: string,
		readonly dir: string,
		private readonly fs: Fs,
	) {}

	async ensure(): Promise<void> {
		await this.fs.mkdir(this.dir);
	}

	async read(name: string): Promise<string | null> {
		return readIfThere(this.fs, this.at(name), (path) => this.fs.read(path));
	}

	async write(name: string, text: string): Promise<void> {
		return replace(this.fs, this.at(name), text);
	}

	async readBytes(name: string): Promise<Uint8Array | null> {
		return readIfThere(this.fs, this.at(name), (path) =>
			this.fs.readBytes(path),
		);
	}

	async writeBytes(name: string, bytes: Uint8Array): Promise<void> {
		return replace(this.fs, this.at(name), bytes);
	}

	async list(): Promise<string[]> {
		return (await this.files()).map((file) => file.name);
	}

	async entries(): Promise<CollectionEntry[]> {
		return this.files();
	}

	async remove(name: string): Promise<void> {
		return this.fs.rm(this.at(name), { force: true });
	}

	async clear(): Promise<void> {
		for (const name of await this.list()) {
			await this.remove(name);
		}
	}

	async size(): Promise<number> {
		return (await this.files()).reduce((sum, file) => sum + file.size, 0);
	}

	private at(name: string): string {
		return `${this.dir}/${checkName(name)}`;
	}

	/** Each file held, sorted, leaving out directories and writes in flight. */
	private async files(): Promise<{ name: string; size: number }[]> {
		const names =
			(await readIfThere(this.fs, this.dir, (dir) => this.fs.readdir(dir))) ??
			[];
		const files: { name: string; size: number }[] = [];
		for (const name of names.sort()) {
			if (name.endsWith(".tmp")) {
				continue;
			}
			const stat = await this.fs.stat(`${this.dir}/${name}`).catch(() => null);
			if (stat !== null && !stat.isDirectory()) {
				files.push({ name, size: stat.size });
			}
		}
		return files;
	}
}
