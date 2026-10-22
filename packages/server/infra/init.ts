import type { Fs } from "webappwiz/system";
import type { DeployKeyProject } from "./deploy-keys";

export interface InfraInitOptions {
	/** The directory the Pulumi project is written in. */
	dir: string;
	stack: string;
	host: string;
	email: string;
	region: string;
	projects: DeployKeyProject[];
	/** A Pulumi ESC environment the stack imports, as `splates/aws`; none imports none. */
	environment?: string;
	/** The Cloudflare account's id, when known; otherwise left to set. */
	accountId?: string;
	/** The id of the zone `host` is in, when known. */
	zoneId?: string;
	fs: Fs;
}

export interface InfraInitResult {
	/** The files it wrote or changed, relative to `dir`. */
	written: string[];
	/** Each command still to run: the account and zone ids. */
	todo: string[];
	/** The secrets the stack needs from the creds store, by key. They never go in the stack's config. */
	secrets: string[];
}

/** The GitHub owner of `owner/repo`. */
export function ownerOf(repository: string): string {
	return repository.slice(0, repository.indexOf("/"));
}

/**
 * The `splates` config name of the secret holding the GitHub token for
 * `owner`'s repositories: a fine-grained token covers one owner, so each
 * gets its own.
 */
export function githubTokenName(owner: string): string {
	return `githubToken-${owner}`;
}

/** The cred keeping the GitHub token for `owner`'s repositories, which the program reads from its environment under this name. */
export function githubTokenCred(owner: string): string {
	return `SPLATES_DEPLOY_GITHUB_TOKEN_${owner.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** The GitHub owner whose token stack secret `key` holds, or null for any other. */
export function githubOwnerOf(key: string): string | null {
	const prefix = `splates:${githubTokenName("")}`;
	return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/**
 * The secrets the stack needs, which the user looks up or keeps: a GitHub
 * token for each owner the projects are under. They stay in the creds store
 * and reach each `pulumi` run in its environment, never the stack's config.
 */
export function secretsOf(projects: DeployKeyProject[]): string[] {
	const owners = new Set(projects.map(({ repository }) => ownerOf(repository)));
	return [
		"cloudflare:apiToken",
		...[...owners].map((owner) => `splates:${githubTokenName(owner)}`),
		"splates:anthropicKey",
	];
}

/** The stack config keys a secret was once set under. */
const SECRET_KEYS =
	/^(cloudflare:apiToken|splates:(githubToken-.*|anthropicKey))$/;

/** The Cloudflare ids of the account and zone, which only its dashboard shows. */
const IDS = ["splates:accountId", "splates:zoneId"] as const;

/**
 * Writes the user's own Pulumi project, which imports the components of
 * `@stringsync/splates-server/infra`, with what setup knows in the stack's
 * config, and a `.gitignore` that keeps the stack's file out of git, since
 * its config is the user's own. Run again, it writes only what is not so
 * already: the program and `Pulumi.yaml` as given, and in the stack's config only the keys it lacks,
 * so values the user changed stay. A secret a past run set in the config is
 * taken out, since it would win over the creds store's current value.
 */
export async function infraInit(
	opts: InfraInitOptions,
): Promise<InfraInitResult> {
	const { dir, fs } = opts;
	const written: string[] = [];
	const put = async (name: string, text: string) => {
		const path = `${dir}/${name}`;
		if ((await fs.exists(path)) && (await fs.read(path)) === text) {
			return;
		}
		await fs.write(path, text);
		written.push(name);
	};
	await fs.mkdir(dir, { recursive: true });
	await put("Pulumi.yaml", PULUMI_YAML);
	await put("index.ts", INDEX_TS);
	await put(".gitignore", GITIGNORE);

	const stackFile = `Pulumi.${opts.stack}.yaml`;
	const stack = await readStack(fs, `${dir}/${stackFile}`);
	const wanted: Record<string, unknown> = {
		"aws:region": opts.region,
		"splates:host": opts.host,
		"splates:email": opts.email,
		"splates:projects": opts.projects,
		...(opts.accountId === undefined
			? {}
			: { "splates:accountId": opts.accountId }),
		...(opts.zoneId === undefined ? {} : { "splates:zoneId": opts.zoneId }),
	};
	const config = { ...stack.config };
	const secrets = secretsOf(opts.projects);
	for (const key of Object.keys(config)) {
		if (SECRET_KEYS.test(key)) {
			delete config[key];
		}
	}
	for (const [key, value] of Object.entries(wanted)) {
		if (!(key in config)) {
			config[key] = value;
		}
	}
	await put(
		stackFile,
		stackText(withEnvironment({ ...stack, config }, opts.environment)),
	);

	return {
		written,
		secrets,
		todo: [
			...IDS.filter((key) => !(key in config)).map(
				(key) => `pulumi config set ${key} <id>`,
			),
		],
	};
}

const PULUMI_YAML = `name: splates
runtime:
  name: bun
description: The box \`splates server deploy\` installs splates on
`;

/** Each stack's config is one user's accounts, hosts and ids, never committed. */
const GITIGNORE = `Pulumi.*.yaml
`;

/** The program the user edits: three components, all from config. */
const INDEX_TS = `import * as pulumi from "@pulumi/pulumi";
import {
	CoordinatorBox,
	DeployKeys,
	envSecret,
	Tunnel,
} from "@stringsync/splates-server/infra";

const config = new pulumi.Config("splates");
const host = config.require("host");

const tunnel = new Tunnel("splates", {
	host,
	email: config.require("email"),
	accountId: config.require("accountId"),
	zoneId: config.require("zoneId"),
});
new DeployKeys("keys", { projects: config.requireObject("projects") });
const box = new CoordinatorBox("splates", {
	host,
	secrets: {
		SPLATES_TUNNEL_TOKEN: tunnel.token,
		SPLATES_CLOUDFLARE_API_TOKEN: envSecret("SPLATES_CLOUDFLARE_API_TOKEN"),
		ANTHROPIC_API_KEY: envSecret("ANTHROPIC_API_KEY"),
	},
});

export const instanceId = box.instanceId;
export const ipv4 = box.ipv4;
export const roleName = box.roleName;
export const sshKey = box.sshKey;
export const tunnelHost = box.host;
export const tunnelRecord = {
	team: tunnel.team,
	aud: tunnel.aud,
	id: tunnel.tunnelId,
};
`;

/**
 * Has the stack in `path` import ESC environment `environment`, as
 * `Pulumi.<stack>.yaml`'s `environment:` lists it, keeping the rest of the
 * file; answers whether it changed anything.
 */
export async function importEnvironment(
	fs: Fs,
	path: string,
	environment: string,
): Promise<boolean> {
	const stack = await readStack(fs, path);
	const imported = withEnvironment(stack, environment);
	if (imported === stack) {
		return false;
	}
	await fs.write(path, stackText(imported));
	return true;
}

/** A stack's settings file as YAML reads it: its config, and whatever else the user put there. */
type StackFile = Record<string, unknown> & { config: Record<string, unknown> };

async function readStack(fs: Fs, path: string): Promise<StackFile> {
	const parsed = (await fs.exists(path))
		? (Bun.YAML.parse(await fs.read(path)) as Record<string, unknown> | null)
		: null;
	const config = parsed?.config;
	return {
		...parsed,
		config:
			typeof config === "object" && config !== null
				? (config as Record<string, unknown>)
				: {},
	};
}

/** `stack` importing `environment` too, itself when it already does or there is none. */
function withEnvironment(
	stack: StackFile,
	environment: string | undefined,
): StackFile {
	const listed = stack.environment ?? [];
	// Any other shape is the user's own, to edit by hand.
	if (
		environment === undefined ||
		!Array.isArray(listed) ||
		listed.includes(environment)
	) {
		return stack;
	}
	return { ...stack, environment: [...listed, environment] };
}

function stackText(stack: StackFile): string {
	return `${Bun.YAML.stringify(stack, null, 2)}\n`;
}
