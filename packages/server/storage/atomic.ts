import { dirname } from "node:path";
import type { Fs } from "webappwiz/system";

/**
 * Writes `data` to `path` through a file beside it renamed into place, so a
 * reader, or a crash mid-write, never leaves half of it there.
 */
export async function replace(
	fs: Fs,
	path: string,
	data: string | Uint8Array,
): Promise<void> {
	await fs.mkdir(dirname(path));
	const tmp = `${path}.${crypto.randomUUID()}.tmp`;
	try {
		await (typeof data === "string"
			? fs.write(tmp, data)
			: fs.writeBytes(tmp, data));
		await fs.rename(tmp, path);
	} catch (error) {
		await fs.rm(tmp, { force: true }).catch(() => {});
		throw error;
	}
}

/**
 * What `read` gives of `path`, or null when nothing is there: an error
 * reading a file that is there is still thrown, so a store never takes an
 * unreadable file for a missing one and writes over it. A file another
 * writer moved into place after the read missed it is read again.
 */
export async function readIfThere<T>(
	fs: Fs,
	path: string,
	read: (path: string) => Promise<T>,
): Promise<T | null> {
	try {
		return await read(path);
	} catch {
		if (await fs.exists(path)) {
			return read(path);
		}
		return null;
	}
}
