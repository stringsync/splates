import type { Ps } from "webappwiz/system";

/** What a server exits with to be started again as it was. */
export const RESTART = 75;

/** What a server exits with to be started again on the newest arbor. */
export const UPDATE = 76;

/**
 * Set in the server's environment, so the `arbor dev` it runs serves rather
 * than supervising another.
 */
export const SERVING = "ARBOR_DEV_SERVING";

/**
 * Set in the server's environment when building its page failed, so the page
 * it serves, the one built before, says it may be out of date.
 */
export const UNBUILT = "ARBOR_DEV_UNBUILT";

/** What starts `arbor dev` on the newest arbor, with `args` after `dev`. */
const NEWEST = ["bunx", "@webappwiz/arbor@latest"];

/** What `supervise` starts the server with, beyond the process it runs in. */
export interface SuperviseOptions {
	/**
	 * Builds the page, run before each start of the same arbor, as from a
	 * checkout, whose page `bun install` built last and the commits since may
	 * have changed, packages they added included; null for one installed from
	 * npm, whose page shipped built.
	 */
	build?: { argv: string[]; cwd: string } | null;
	/** Added to the server's environment, as a slot's home is. */
	env?: Record<string, string>;
	/** Where the server runs, the working directory by default. */
	cwd?: string;
}

/**
 * Runs `arbor dev` as a child of this process, sharing its terminal, and
 * starts another each time the child exits to restart: as this one was
 * started, or on the newest arbor when it asks to update. Ctrl-C reaches the
 * child too, and its exit ends this. A SIGTERM or SIGHUP to this one stops the
 * child with a SIGTERM and ends this, since the child would otherwise outlive
 * it, listening on its port. Answers with the exit code to end on.
 */
export async function supervise(
	ps: Ps,
	{ build = null, env = {}, cwd }: SuperviseOptions = {},
): Promise<number> {
	let argv = [...ps.self, ...ps.args];
	// Built until it updates: npm's arbor ships its page.
	let building = build;
	// Ctrl-C is the child's to end on, and its exit then ends this.
	const quiet = ps.on("SIGINT", () => {});
	const stopping = new AbortController();
	let stopped = 0;
	const stopOn = (signal: string, code: number) =>
		ps.on(signal, () => {
			stopped = code;
			stopping.abort();
		});
	const terminated = stopOn("SIGTERM", 128 + 15);
	const hungUp = stopOn("SIGHUP", 128 + 1);
	try {
		for (;;) {
			// A failed build has said why on the terminal, and the page it left
			// behind is still one to serve, saying it failed.
			const built =
				building === null ||
				(await ps.spawn(building.argv, { cwd: building.cwd })).exitCode === 0;
			if (stopping.signal.aborted) {
				return stopped;
			}
			let exitCode: number;
			try {
				({ exitCode } = await ps.spawn(argv, {
					env: {
						...env,
						[SERVING]: "1",
						...(built ? {} : { [UNBUILT]: "1" }),
					},
					cwd,
					signal: stopping.signal,
				}));
			} catch (error) {
				// An abort rejects the spawn once the child is gone.
				if (stopping.signal.aborted) {
					return stopped;
				}
				throw error;
			}
			if (exitCode === UPDATE) {
				argv = [...NEWEST, ...ps.args];
				building = null;
			} else if (exitCode !== RESTART) {
				return exitCode;
			}
		}
	} finally {
		quiet.dispose();
		terminated.dispose();
		hungUp.dispose();
	}
}
