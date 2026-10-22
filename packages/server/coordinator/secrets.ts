import type { Fs } from "webappwiz/system";
import { githubTokenCred } from "../infra/init";
import { API_TOKEN } from "../tunnel/saved";

/** What reads the creds store, as a `Credentials` does. */
export interface SecretSource {
	get(name: string): Promise<string | undefined>;
}

/**
 * Every cred the infra project reads from its environment: the Cloudflare
 * token, the Anthropic key and a GitHub token for each owner of its
 * `splates:projects`, read off the stack's config in `dir`.
 */
export async function secretNames(
	fs: Fs,
	dir: string,
	stack: string | undefined,
): Promise<string[]> {
	const path = `${dir}/Pulumi.${stack ?? ""}.yaml`;
	const parsed =
		stack !== undefined && (await fs.exists(path))
			? (Bun.YAML.parse(await fs.read(path)) as {
					config?: Record<string, unknown>;
				} | null)
			: null;
	const projects = parsed?.config?.["splates:projects"];
	const owners = new Set<string>();
	for (const project of Array.isArray(projects) ? projects : []) {
		const repository = (project as { repository?: unknown }).repository;
		if (typeof repository === "string" && repository.includes("/")) {
			owners.add(repository.slice(0, repository.indexOf("/")));
		}
	}
	return [
		API_TOKEN,
		"ANTHROPIC_API_KEY",
		...[...owners].map((owner) => githubTokenCred(owner)),
	];
}

/**
 * The environment a `pulumi` run that runs the program gets: each cred the
 * project reads, from the creds store as it is now. Throws naming the creds
 * the store lacks.
 */
export async function stackEnv(
	fs: Fs,
	source: SecretSource,
	dir: string,
	stack: string | undefined,
): Promise<Record<string, string>> {
	const env: Record<string, string> = {};
	const lacking: string[] = [];
	for (const name of await secretNames(fs, dir, stack)) {
		const value = await source.get(name);
		if (value === undefined) {
			lacking.push(name);
		} else {
			env[name] = value;
		}
	}
	if (lacking.length > 0) {
		throw new Error(
			`the stack reads ${lacking.join(", ")} from the creds store, which lacks ${lacking.length === 1 ? "it" : "them"}: \`splates server infra init\` requests what is missing on the Creds page, then press Next again`,
		);
	}
	// The Cloudflare provider reads its token from this variable when the config has none.
	env.CLOUDFLARE_API_TOKEN = env[API_TOKEN] as string;
	return env;
}

/**
 * The creds the provider named in a failed resource's line reads, so a 401
 * says which one to replace; null for any other failure.
 */
export function credsFor(failure: string, names: string[]): string[] | null {
	if (
		!/\b(401|403|unauthori[sz]ed|bad credentials|authentication)/i.test(failure)
	) {
		return null;
	}
	const provider = failure.match(/^(\w+):/)?.[1];
	if (provider === "cloudflare") {
		return [API_TOKEN];
	}
	if (provider === "github") {
		const tokens = names.filter((name) =>
			name.startsWith("SPLATES_DEPLOY_GITHUB_TOKEN_"),
		);
		return tokens.length === 0 ? null : tokens;
	}
	return null;
}
