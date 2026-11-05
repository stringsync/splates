import type { Logger } from "core/log";
import type { Fs } from "core/system";

export const SESSION_STORE_LIMIT = 5_000_000_000;
/** Shared with integrations that disclose rec's retention policy. */
export const SESSION_STORE_POLICY =
	"Sessions are saved in ~/.rec/sessions. After each save, rec deletes the oldest sessions first, whatever their name, until the store fits within 5 GB. The session just saved is never deleted, even if it alone exceeds the limit. --out folders are outside this store and its limit. Existing ~/Desktop/rec folders are left alone.";

/** Keep completed sessions within a byte limit by calling prune after each save. */
export class SessionStore {
	constructor(
		private readonly fs: Fs,
		private readonly log: Logger,
		readonly root: string,
		private readonly limit = SESSION_STORE_LIMIT,
	) {}

	private async bytes(path: string): Promise<number> {
		if (await this.fs.isSymlink(path)) {
			return 0;
		}
		const stat = await this.fs.stat(path);
		if (!stat.isDirectory()) {
			return stat.size;
		}
		let size = 0;
		for (const entry of await this.fs.readdir(path)) {
			size += await this.bytes(`${path}/${entry}`);
		}
		return size;
	}

	async prune(
		saved: string,
		pending: ReadonlySet<string> = new Set(),
	): Promise<void> {
		const sessions: { path: string; size: number; at: number }[] = [];
		let total = 0;
		for (const entry of await this.fs.readdir(this.root)) {
			const path = `${this.root}/${entry}`;
			if (await this.fs.isSymlink(path)) {
				continue;
			}
			const size = await this.bytes(path);
			total += size;
			// A recording still being written has no manifest and cannot be evicted.
			if (!(await this.fs.stat(path)).isDirectory()) {
				continue;
			}
			try {
				const manifest = JSON.parse(
					await this.fs.read(`${path}/manifest.json`),
				);
				if (Number.isFinite(manifest.startedAt)) {
					sessions.push({ path, size, at: manifest.startedAt });
				}
			} catch {
				// Leave unfinished or unrecognized folders alone.
			}
		}
		sessions.sort(
			(left, right) =>
				left.at - right.at || left.path.localeCompare(right.path),
		);
		for (const session of sessions) {
			if (total <= this.limit) {
				break;
			}
			if (session.path === saved || pending.has(session.path)) {
				continue;
			}
			await this.fs.rm(session.path, { recursive: true });
			total -= session.size;
			this.log.info(
				`deleted session ${session.path} to keep the store within 5 GB`,
			);
		}
		if (total > this.limit) {
			this.log.info(
				"Session store exceeds 5 GB; the session just saved and unfinished folders are kept",
			);
		}
	}
}
