import type { Fs } from "webappwiz/system";
import { z } from "zod";
import type { KeptShell } from "./dev-shell";

/** What `coordinator.json` holds. */
const Kept = z.object({
	session: z.string().min(1),
	roots: z.array(z.string()).default([]),
	terminals: z
		.array(
			z.object({
				key: z.string(),
				handle: z.object({ worker: z.string(), channel: z.number().int() }),
			}),
		)
		.default([]),
});

/**
 * What one `arbor dev` keeps across its own restarts, in
 * `~/.arbor/coordinator.json`: the session id its workers know it by, so a
 * worker finds the next run unchanged and keeps every agent it runs for it,
 * and the roots of the projects whose agents it let go of at its last
 * restart, for the next run to serve before the worker joins and take them
 * back, and the shells it let go of, for the next run to take back too.
 */
export class CoordinatorState {
	private constructor(
		readonly path: string,
		private readonly fs: Fs,
		/** What this coordinator's worker sessions answer as, the same across restarts. */
		readonly session: string,
		/** The projects with agents on the worker at the last restart; none after a fresh start. */
		readonly roots: string[],
		/** The pages' shells on the worker at the last restart, by key. */
		readonly terminals: KeptShell[],
	) {}

	/**
	 * Reads what the last run kept at `path`, or starts afresh with a session
	 * of its own, written there so the next run answers as the same.
	 */
	static async open(path: string, fs: Fs): Promise<CoordinatorState> {
		const read = await fs.read(path).catch(() => null);
		if (read !== null) {
			try {
				const kept = Kept.parse(JSON.parse(read));
				return new CoordinatorState(
					path,
					fs,
					kept.session,
					kept.roots,
					kept.terminals,
				);
			} catch {
				// Unreadable: a new session, which ends what the worker held.
			}
		}
		const state = new CoordinatorState(path, fs, crypto.randomUUID(), [], []);
		await state.write([], []);
		return state;
	}

	/** Keeps `roots` as the projects whose agents, and `terminals` as the shells, the next run takes back. */
	async write(roots: string[], terminals: KeptShell[]): Promise<void> {
		await this.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")));
		await this.fs.write(
			this.path,
			`${JSON.stringify({ session: this.session, roots, terminals })}\n`,
		);
	}
}
