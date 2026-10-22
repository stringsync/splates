import type { Ps } from "webappwiz/system";
import type { DeployKeyProject } from "./deploy-keys";
import { githubOwnerOf, ownerOf } from "./init";

/**
 * The Pulumi ESC environment, by project and name, that holds the stack's
 * secrets, as the stack's `environment:` imports it. The user pastes each
 * value there on the Pulumi site; splates writes only placeholders and reads
 * only whether each is still one, so no secret passes through it.
 */
export const SECRETS_ENVIRONMENT = "splates/secrets";

/** What a secret reads until the user pastes it, which is how splates tells it is not set. */
export const SECRET_PLACEHOLDER =
	"paste it here as a secret, as splates setup says";

/** What the stack's Cloudflare token needs, as the dashboard names each. */
export const CLOUDFLARE_PERMISSIONS = [
	"Account · Cloudflare Tunnel · Edit",
	"Account · Access: Apps and Policies · Edit",
	"Account · Access: Service Tokens · Edit",
	"Zone · DNS · Edit",
] as const;

/** `SECRETS_ENVIRONMENT` in `org`, as `pulumi env` names it. */
export function secretsEnvironmentIn(org: string): string {
	return `${org}/${SECRETS_ENVIRONMENT}`;
}

/** Where the user edits the environment on the Pulumi site. */
export function secretsEnvironmentUrl(org: string): string {
	return `https://app.pulumi.com/${org}/esc/${SECRETS_ENVIRONMENT}`;
}

/**
 * Whether each secret in `org`'s environment is set, by key: set once its
 * value is anything but the placeholder, which a secret pasted on the Pulumi
 * site reads as its ciphertext. The definition is read without
 * `--show-secrets`, so no value reaches splates. Null when the environment
 * is not there or Pulumi cannot be asked.
 */
export async function secretsSet(
	ps: Ps,
	org: string,
): Promise<Map<string, boolean> | null> {
	const ran = await ps
		.spawnCapture([
			"pulumi",
			"env",
			"get",
			secretsEnvironmentIn(org),
			"--definition",
		])
		.catch(() => null);
	if (ran === null || ran.exitCode !== 0) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(ran.stdout);
	} catch {
		return null;
	}
	const config = (parsed as { values?: { pulumiConfig?: unknown } } | null)
		?.values?.pulumiConfig;
	const set = new Map<string, boolean>();
	if (typeof config === "object" && config !== null) {
		for (const [key, value] of Object.entries(config)) {
			set.set(
				key,
				value !== null && value !== "" && value !== SECRET_PLACEHOLDER,
			);
		}
	}
	return set;
}

/**
 * Makes `org`'s environment with a placeholder for each of `keys`, or adds
 * one for each key it lacks, leaving every value already there as it is.
 * Throws with what Pulumi said.
 */
export async function writeSecretsEnvironment(
	ps: Ps,
	org: string,
	keys: readonly string[],
): Promise<void> {
	const name = secretsEnvironmentIn(org);
	const run = async (argv: string[], stdin?: string) => {
		const ran = await ps.spawnCapture(
			argv,
			stdin === undefined ? {} : { stdin },
		);
		if (ran.exitCode !== 0) {
			throw new Error(
				`\`${argv.slice(0, 4).join(" ")}\` failed: ${(ran.stderr || ran.stdout).trim()}`,
			);
		}
	};
	const set = await secretsSet(ps, org);
	if (set === null) {
		const lines = keys.map(
			(key) =>
				`    ${JSON.stringify(key)}: ${JSON.stringify(SECRET_PLACEHOLDER)}`,
		);
		await run(
			["pulumi", "env", "init", name, "-f", "-"],
			`values:\n  pulumiConfig:\n${lines.join("\n")}\n`,
		);
		return;
	}
	for (const key of keys) {
		if (!set.has(key)) {
			await run([
				"pulumi",
				"env",
				"set",
				name,
				`pulumiConfig[${JSON.stringify(key)}]`,
				SECRET_PLACEHOLDER,
				"--string",
			]);
		}
	}
}

/** What a secret is for and how to get it, as its setup step says. */
export interface SecretHelp {
	/** A few words naming it, as "the Anthropic API key". */
	name: string;
	purpose: string;
	/** Markdown steps that end with the value copied. */
	instructions: string;
}

/** How to get the secret stack config key `key` holds, for the projects the box pushes. */
export function secretHelp(
	key: string,
	projects: readonly DeployKeyProject[],
): SecretHelp {
	const owner = githubOwnerOf(key);
	if (owner !== null) {
		const repositories = projects
			.filter(({ repository }) => ownerOf(repository) === owner)
			.map(({ repository }) => `\`${repository}\``);
		return {
			name: `the GitHub token for ${owner}`,
			purpose: `The stack makes a deploy key on each of ${owner}'s repositories that splates pushes (${repositories.join(", ")}), so the box can clone and push trunk.`,
			instructions: [
				"1. Open [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).",
				`2. Pick **${owner}** as the resource owner, then **Only select repositories** and ${repositories.join(", ")}, and give **Administration: Read and write**.`,
				"3. Generate it and copy it.",
			].join("\n"),
		};
	}
	if (key === "cloudflare:apiToken") {
		return {
			name: "the Cloudflare API token",
			purpose:
				"The stack makes the box's tunnel, its DNS record and the Access application in front of it, and the box keeps the token to manage them.",
			instructions: [
				"1. Open [API Tokens](https://dash.cloudflare.com/profile/api-tokens), then **Create Token** and **Create Custom Token**.",
				`2. Give it ${CLOUDFLARE_PERMISSIONS.map((each) => `**${each}**`).join(", ")}, the zone your host is in.`,
				"3. Create it and copy it.",
			].join("\n"),
		};
	}
	return {
		name: "the Anthropic API key",
		purpose: "The box keeps it, so agents that run there can reach Anthropic.",
		instructions: [
			"1. Open [API keys](https://console.anthropic.com/settings/keys), then **Create Key**.",
			"2. Copy it.",
		].join("\n"),
	};
}
