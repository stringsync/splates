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
		["gh", "auth", "login"],
		"the release uploads to GitHub, but gh is not logged in",
	);
	await ensure(
		ps,
		() => dockerLoggedIn(ps, fs),
		["docker", "login", REGISTRY],
		`the release pushes the runner image, but Docker has no login for ${REGISTRY}`,
	);
}

async function ensure(
	ps: Ps,
	loggedIn: () => Promise<boolean>,
	login: string[],
	missing: string,
): Promise<void> {
	if (await loggedIn()) {
		return;
	}
	const command = login.join(" ");
	// No terminal means nobody to answer the login's prompts.
	if (ps.columns() === undefined) {
		throw new Error(`${missing}; run ${command}, then splates dev ship`);
	}
	console.log(`${missing}; running ${command}`);
	const result = await ps.spawn(login);
	if (result.exitCode !== 0 || !(await loggedIn())) {
		throw new Error(
			`${command} did not log in; fix that, then splates dev ship`,
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
