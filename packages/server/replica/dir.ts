import { dirname } from "node:path";
import type { Fs } from "webappwiz/system";
import { keyIn, replace } from "../storage";
import { byKey, md5, type Replica, type ReplicaObject } from "./replica";

/**
 * A replica in a folder, each key a file under it: for tests, and for a
 * backup on a disk of the machine's own, as a mounted drive.
 */
export class DirReplica implements Replica {
	readonly name: string;

	constructor(
		readonly dir: string,
		private readonly fs: Fs,
	) {
		this.name = dir;
	}

	async put(key: string, bytes: Uint8Array): Promise<void> {
		await replace(this.fs, this.path(key), bytes);
	}

	async get(key: string): Promise<Uint8Array | null> {
		const path = this.path(key);
		if (!(await this.fs.exists(path))) {
			return null;
		}
		return this.fs.readBytes(path);
	}

	async list(key: string): Promise<ReplicaObject[]> {
		const found: ReplicaObject[] = [];
		const walk = async (at: string): Promise<void> => {
			const dir = this.path(at);
			for (const name of await this.fs.readdir(dir).catch(() => [])) {
				const child = at === "" ? name : `${at}/${name}`;
				const stat = await this.fs.stat(`${dir}/${name}`).catch(() => null);
				if (stat?.isDirectory()) {
					await walk(child);
				} else if (stat !== null && !name.endsWith(".tmp")) {
					const bytes = await this.fs.readBytes(`${dir}/${name}`);
					found.push({ key: child, size: bytes.length, md5: md5(bytes) });
				}
			}
		};
		await walk(key);
		return found.sort(byKey);
	}

	async delete(key: string): Promise<void> {
		const path = this.path(key);
		await this.fs.rm(path, { force: true });
		// Leave no empty folder behind, as a bucket has none.
		for (
			let dir = dirname(path);
			dir.startsWith(`${this.dir}/`);
			dir = dirname(dir)
		) {
			if ((await this.fs.readdir(dir).catch(() => [null])).length > 0) {
				break;
			}
			await this.fs.rm(dir, { recursive: true, force: true });
		}
	}

	private path(key: string): string {
		return keyIn(this.dir, key);
	}
}
