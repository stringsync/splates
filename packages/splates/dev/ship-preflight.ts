import type { Ps } from "webappwiz/system";

/**
 * Makes sure the machine can finish a release before anything is built or
 * stamped: a `gh` login, which the release's last stage creates its GitHub
 * release with. A missing one is offered its login on a terminal, as `npm
 * login` is, and stops the release where there is none to ask.
 */
export async function preflight(ps: Ps): Promise<void> {
	if (await ghLoggedIn(ps)) {
		return;
	}
	const missing =
		"the release creates a GitHub release, but gh is not logged in";
	// No terminal means nobody to answer the login's prompts.
	if (ps.columns() === undefined) {
		throw new Error(`${missing}; run gh auth login, then splates dev ship`);
	}
	console.log(`${missing}; logging in`);
	if (
		(await ps.spawn(["gh", "auth", "login"])).exitCode !== 0 ||
		!(await ghLoggedIn(ps))
	) {
		throw new Error(
			"gh auth login did not log in; fix that, then splates dev ship",
		);
	}
}

async function ghLoggedIn(ps: Ps): Promise<boolean> {
	return (await ps.spawnCapture(["gh", "auth", "status"])).exitCode === 0;
}
