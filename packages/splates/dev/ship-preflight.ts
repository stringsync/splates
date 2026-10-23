import type { Fs, Ps } from "webappwiz/system";

const REGISTRY = "ghcr.io";

/**
 * Fails before a release is cut when the machine cannot finish it: no `gh`
 * login for the binary upload, or no Docker login for the image push. Both
 * come last in a release, after the version is bumped and tagged, so a
 * missing one would otherwise strand a half-made release. A login that
 * exists may still lack write access to the package; only the push shows that.
 */
export async function preflight(ps: Ps, fs: Fs): Promise<void> {
	const gh = await ps.spawnCapture(["gh", "auth", "status"]);
	if (gh.exitCode !== 0) {
		throw new Error(
			"the release uploads to GitHub, but gh is not logged in; run gh auth login, then splates dev ship",
		);
	}
	if (!(await dockerLoggedIn(ps, fs))) {
		throw new Error(
			`the release pushes the runner image, but Docker has no login for ${REGISTRY}; ` +
				`run docker login ${REGISTRY} with a token that has write:packages, then splates dev ship`,
		);
	}
}

async function dockerLoggedIn(ps: Ps, fs: Fs): Promise<boolean> {
	const dir = ps.env("DOCKER_CONFIG") ?? `${ps.env("HOME") ?? ""}/.docker`;
	const path = `${dir}/config.json`;
	if (!(await fs.exists(path))) {
		return false;
	}
	let config: {
		auths?: Record<string, unknown>;
		credHelpers?: Record<string, string>;
		credsStore?: string;
	};
	try {
		config = JSON.parse(await fs.read(path));
	} catch {
		return false;
	}
	if (config.auths && REGISTRY in config.auths) {
		return true;
	}
	const helper = config.credHelpers?.[REGISTRY] ?? config.credsStore;
	if (!helper) {
		return false;
	}
	// A credential helper lists the servers it holds a login for.
	const listed = await ps.spawnCapture([`docker-credential-${helper}`, "list"]);
	return listed.exitCode === 0 && listed.stdout.includes(`${REGISTRY}"`);
}
