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
	fs: Fs;
}

export interface InfraInitResult {
	/** The files it wrote or changed, relative to `dir`. */
	written: string[];
	/** Each command still to run: the account and zone ids, then each secret. */
	todo: string[];
}

/** What the user sets themselves, since it is theirs to look up or to keep. */
export const SECRETS = [
	"cloudflare:apiToken",
	"github:token",
	"splates:anthropicKey",
] as const;

/** The Cloudflare ids of the account and zone, which only its dashboard shows. */
const IDS = ["splates:accountId", "splates:zoneId"] as const;

const PULUMI_YAML = `name: splates
runtime:
  name: nodejs
  options:
    packagemanager: bun
description: The box \`splates server deploy\` installs splates on
`;

/** The program the user edits: three components, all from config. */
const INDEX_TS = `import * as pulumi from "@pulumi/pulumi";
import { CoordinatorBox, DeployKeys, Tunnel } from "@stringsync/splates-server/infra";

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
		ANTHROPIC_API_KEY: config.requireSecret("anthropicKey"),
	},
});

export const instanceId = box.instanceId;
export const ipv4 = box.ipv4;
export const roleName = box.roleName;
export const sshKey = box.sshKey;
export const tunnelHost = box.host;
`;

/**
 * Writes the user's own Pulumi project, which imports the components of
 * `@stringsync/splates-server/infra`, with what setup knows in the stack's
 * config. Run again, it writes only what is not so already: the program and
 * `Pulumi.yaml` as given, and in the stack's config only the keys it lacks,
 * so values the user changed stay.
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

	const stackFile = `Pulumi.${opts.stack}.yaml`;
	const path = `${dir}/${stackFile}`;
	const existing = (await fs.exists(path))
		? ((
				Bun.YAML.parse(await fs.read(path)) as {
					config?: Record<string, unknown>;
				} | null
			)?.config ?? {})
		: {};
	const wanted: Record<string, unknown> = {
		"aws:region": opts.region,
		"splates:host": opts.host,
		"splates:email": opts.email,
		"splates:projects": opts.projects,
	};
	const config = { ...existing };
	for (const [key, value] of Object.entries(wanted)) {
		if (!(key in config)) {
			config[key] = value;
		}
	}
	await put(stackFile, `${Bun.YAML.stringify({ config }, null, 2)}\n`);

	return {
		written,
		todo: [
			...IDS.filter((key) => !(key in config)).map(
				(key) => `pulumi config set ${key} <id>`,
			),
			...SECRETS.filter((key) => !(key in config)).map(
				(key) => `pulumi config set --secret ${key}`,
			),
		],
	};
}
