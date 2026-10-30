import type { Fs, Ps } from "webappwiz/system";
import { NPM_ENV } from "./npm-terminal";

/** The npmrc line that signs npm in as the token in `NPM_TOKEN`, which npm expands itself. */
const TOKEN_NPMRC = `//registry.npmjs.org/:_authToken=\${NPM_TOKEN}
`;

/** Why a ship stopped on a token npm turned away. */
export const TOKEN_REFUSED =
	"npm refused the NPM_TOKEN in the creds store: it may have expired, been revoked, or be limited to IP ranges this machine is outside of; make a new granular token and replace it on the Creds page";

/**
 * What `npm whoami` says under the environment a ship's npm runs in, with
 * `token` signed in when there is one, and that environment.
 */
export async function checkNpm(
	{ fs, ps, dir, root }: { fs: Fs; ps: Ps; dir: string; root: string },
	token: string | undefined,
) {
	const env: Record<string, string> = {
		...NPM_ENV,
		...(token === undefined ? {} : await tokenEnv(fs, dir, token)),
	};
	return {
		env,
		whoami: await ps.spawnCapture(["npm", "whoami"], { cwd: root, env }),
	};
}

/**
 * The environment that signs npm in as `token`. The value reaches npm only
 * through the child's environment, by an npmrc that names it, so neither
 * argv nor a file holds it.
 */
async function tokenEnv(
	fs: Fs,
	dir: string,
	token: string,
): Promise<Record<string, string>> {
	const npmrc = `${dir}/ship.npmrc`;
	await fs.write(npmrc, TOKEN_NPMRC);
	return { NPM_TOKEN: token, npm_config_userconfig: npmrc };
}

/** What a ship records of its `npm whoami` check. */
export function whoamiResult(
	whoami: { exitCode: number; stdout: string },
	token: string | undefined,
): string {
	if (whoami.exitCode !== 0) {
		return "npm whoami: not signed in";
	}
	const from = token === undefined ? "" : " (NPM_TOKEN from the creds store)";
	return `npm whoami: ${whoami.stdout.trim() || "signed in"}${from}`;
}
