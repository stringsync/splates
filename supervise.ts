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

/** What starts `arbor dev` on the newest arbor, with `args` after `dev`. */
const NEWEST = ["bunx", "@webappwiz/arbor@latest"];

/** What `supervise` starts the server with, beyond the process it runs in. */
export interface SuperviseOptions {
	/**
	 * Builds the page, run before each start of the same arbor, as from a
	 * checkout, whose page `bun install` built last and the commits since may
	 * have changed; null for one installed from npm, whose page shipped built.
	 */
	build?: string[] | null;
}

/**
 * Runs `arbor dev` as a child of this process, sharing its terminal, and
 * starts another each time the child exits to restart: as this one was
 * started, or on the newest arbor when it asks to update. Ctrl-C reaches the
 * child too, and its exit ends this. Answers with the exit code to end on.
 */
export async function supervise(
	ps: Ps,
	{ build = null }: SuperviseOptions = {},
): Promise<number> {
	let argv = [...ps.self, ...ps.args];
	// Built until it updates: npm's arbor ships its page.
	let building = build;
	// Ctrl-C is the child's to end on, and its exit then ends this.
	const quiet = ps.on("SIGINT", () => {});
	try {
		for (;;) {
			// A failed build has said why on the terminal, and the page it left
			// behind is still one to serve.
			if (building !== null) {
				await ps.spawn(building);
			}
			const { exitCode } = await ps.spawn(argv, { env: { [SERVING]: "1" } });
			if (exitCode === UPDATE) {
				argv = [...NEWEST, ...ps.args];
				building = null;
			} else if (exitCode !== RESTART) {
				return exitCode;
			}
		}
	} finally {
		quiet.dispose();
	}
}
