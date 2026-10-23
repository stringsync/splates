import type { Fs, Ps } from "webappwiz/system";

const REGISTRY = "ghcr.io";

/**
 * Makes sure the machine can finish a release before anything is built or
 * stamped: a `gh` login for the binary upload and a Docker login for the
 * image push. A missing one is offered its login on a terminal, as `npm login`
 * is, and stops the release where there is none to ask. A login that exists
 * may still lack write access to the package; only the push shows that.
 */
export async function preflight(ps: Ps, fs: Fs): Promise<void> {
	await ensure(
		ps,
		async () =>
			(await ps.spawnCapture(["gh", "auth", "status"])).exitCode === 0,
		"gh auth login",
		async () => (await ps.spawn(["gh", "auth", "login"])).exitCode === 0,
		"the release uploads to GitHub, but gh is not logged in",
	);
	await ensure(
		ps,
		() => dockerLoggedIn(ps, fs),
		`docker login ${REGISTRY}`,
		() => dockerLoginViaGh(ps),
		`the release pushes the runner image, but Docker has no login for ${REGISTRY}`,
	);
}

async function ensure(
	ps: Ps,
	loggedIn: () => Promise<boolean>,
	command: string,
	login: () => Promise<boolean>,
	missing: string,
): Promise<void> {
	if (await loggedIn()) {
		return;
	}
	// No terminal means nobody to answer the login's prompts.
	if (ps.columns() === undefined) {
		throw new Error(`${missing}; run ${command}, then splates dev ship`);
	}
	console.log(`${missing}; logging in`);
	if (!(await login()) || !(await loggedIn())) {
		throw new Error(
			`${command} did not log in; fix that, then splates dev ship`,
		);
	}
}

/**
 * Logs Docker in to ghcr.io with gh's own token, so the person signs in
 * through gh's browser flow (a password manager works there) rather than
 * typing a username and a token. The token goes to docker on its stdin, never
 * its arguments.
 */
async function dockerLoginViaGh(ps: Ps): Promise<boolean> {
	// GHCR pushes need write:packages, which gh's default login lacks.
	const refresh = await ps.spawn([
		"gh",
		"auth",
		"refresh",
		"--hostname",
		"github.com",
		"--scopes",
		"write:packages",
	]);
	if (refresh.exitCode !== 0) {
		return false;
	}
	const user = await ps.spawnCapture(["gh", "api", "user", "--jq", ".login"]);
	const token = await ps.spawnCapture(["gh", "auth", "token"]);
	if (user.exitCode !== 0 || token.exitCode !== 0) {
		return false;
	}
	const login = await ps.spawnCapture(
		[
			"docker",
			"login",
			REGISTRY,
			"--username",
			user.stdout.trim(),
			"--password-stdin",
		],
		{ stdin: token.stdout.trim() },
	);
	return login.exitCode === 0;
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
