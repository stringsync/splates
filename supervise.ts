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

/**
 * Runs `arbor dev` as a child of this process, sharing its terminal, and
 * starts another each time the child exits to restart: as this one was
 * started, or on the newest arbor when it asks to update. Ctrl-C reaches the
 * child too, and its exit ends this. Answers with the exit code to end on.
 */
export async function supervise(ps: Ps): Promise<number> {
	let argv = [...ps.self, ...ps.args];
	// Ctrl-C is the child's to end on, and its exit then ends this.
	const quiet = ps.on("SIGINT", () => {});
	try {
		for (;;) {
			const { exitCode } = await ps.spawn(argv, { env: { [SERVING]: "1" } });
			if (exitCode === UPDATE) {
				argv = [...NEWEST, ...ps.args];
			} else if (exitCode !== RESTART) {
				return exitCode;
			}
		}
	} finally {
		quiet.dispose();
	}
}
