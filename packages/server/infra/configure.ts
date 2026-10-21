import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import { fail } from "../exit";
import {
	API_TOKEN,
	App,
	type CloudflareApi,
	CloudflareError,
	CloudflareTunnels,
	Policy,
	type SavedTunnel,
} from "../tunnel";
import type { TunnelCreds } from "../tunnel/setup";
import type { DeployKeyProject } from "./deploy-keys";
import { type InfraInitResult, infraInit } from "./init";

/** Where each stack secret comes from in the creds store. */
export const SECRET_CREDS: Record<string, string> = {
	"cloudflare:apiToken": API_TOKEN,
	"github:token": "SPLATES_DEPLOY_GITHUB_TOKEN",
	"splates:anthropicKey": "ANTHROPIC_API_KEY",
};

export interface InfraConfigureOptions {
	dir: string;
	stack: string;
	region: string;
	/** A Pulumi ESC environment the stack imports; none imports none. */
	environment?: string;
	/**
	 * Left "" for `box.` before the saved tunnel's host: the box comes up on
	 * a host of its own, and the move takes the tunnel's over once it serves.
	 */
	host: string;
	/** Left "" to read it off the saved tunnel's Access application. */
	email: string;
	/** Left null to use every project registered here. */
	projects: DeployKeyProject[] | null;
	/** Each project registered here, for `projects` to be read from. */
	registered(): Promise<{ slug: string; root: string }[]>;
	creds: TunnelCreds;
	saved: SavedTunnel;
	fs: Fs;
	ps: Ps;
	log: Logger;
	fetch?: typeof fetch;
}

/** `owner/repo` of a GitHub remote URL, SSH or HTTPS; null for any other. */
export function repositoryOf(url: string): string | null {
	const match = url
		.trim()
		.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
	return match?.[1] ?? null;
}

/** Every registered project whose origin is on GitHub, as the box pushes it. */
export async function originProjects(
	registered: { slug: string; root: string }[],
	ps: Ps,
): Promise<DeployKeyProject[]> {
	const found: DeployKeyProject[] = [];
	for (const { slug, root } of registered) {
		const { stdout, exitCode } = await ps
			.spawnCapture(["git", "remote", "get-url", "origin"], { cwd: root })
			.catch(() => ({ stdout: "", exitCode: 1 }));
		const repository = exitCode === 0 ? repositoryOf(stdout) : null;
		if (repository !== null) {
			found.push({ slug, repository });
		}
	}
	return found;
}

/** The host the box comes up on while the tunnel's `host` is still the Mac's. */
export function boxHostOf(host: string): string {
	return `box.${host}`;
}

/** The emails the Access application in front of `host` lets in. */
async function accessEmails(
	api: CloudflareApi,
	account: string,
	host: string,
): Promise<string[]> {
	const app = (await api.list(`/accounts/${account}/access/apps`, App)).find(
		(each) => each.domain === host,
	);
	if (app === undefined) {
		return [];
	}
	const ids = new Set(app.policies.map((policy) => policy.id));
	const policies = await api.list(
		`/accounts/${account}/access/policies`,
		Policy,
	);
	return policies
		.filter((policy) => ids.has(policy.id) && policy.decision === "allow")
		.flatMap((policy) =>
			policy.include.flatMap((rule) => {
				const email = (rule.email as { email?: unknown } | undefined)?.email;
				return typeof email === "string" ? [email] : [];
			}),
		);
}

/**
 * What the API token cannot do that the stack needs, as the dashboard names it.
 * Each is probed with a POST of an empty body, which makes nothing: a token
 * that can edit gets a 400 for the missing fields, one that can only read a 403.
 */
export async function missingPermissions(
	api: CloudflareApi,
	account: string,
	zone: string,
): Promise<string[]> {
	const probes: [string, string][] = [
		["Account · Cloudflare Tunnel · Edit", `/accounts/${account}/cfd_tunnel`],
		[
			"Account · Access: Apps and Policies · Edit",
			`/accounts/${account}/access/apps`,
		],
		[
			"Account · Access: Service Tokens · Edit",
			`/accounts/${account}/access/service_tokens`,
		],
		["Zone · DNS · Edit", `/zones/${zone}/dns_records`],
	];
	const missing: string[] = [];
	for (const [permission, path] of probes) {
		try {
			await api.post(path, {}, z.unknown());
		} catch (error) {
			if (!(error instanceof CloudflareError)) {
				throw error;
			}
			if (error.status === 401 || error.status === 403) {
				missing.push(permission);
			}
		}
	}
	return missing;
}

/**
 * Writes the infra project with everything splates keeps filled in: the
 * projects from the registry, the host and email from the saved tunnel and
 * its Access application, the Cloudflare ids from the API, and each secret
 * from the creds store, fed to `pulumi config set --secret` on stdin. What
 * is not kept is requested, and it refuses with `requested`.
 */
export async function infraConfigure(
	opts: InfraConfigureOptions,
): Promise<InfraInitResult> {
	const { creds, ps, log } = opts;
	const record = await opts.saved.read();
	const host =
		opts.host === ""
			? record === null
				? ""
				: boxHostOf(record.host)
			: opts.host;
	if (host === "") {
		fail(
			"usage",
			"no host: pass --host, or run `splates tunnel setup <host>` first so it is read off the tunnel",
			{},
		);
	}
	const cloudflare = await CloudflareTunnels.open(
		creds,
		host,
		null,
		log,
		opts.fetch,
	);
	const { api } = cloudflare;
	const zone = await cloudflare.findZone(host).catch((error: unknown) => {
		fail(
			"cloudflare",
			`looking up ${host} stopped: ${error instanceof Error ? error.message : String(error)}`,
			{ host },
		);
	});
	const account = zone.account.id;
	const missing = await missingPermissions(api, account, zone.id);
	if (missing.length > 0) {
		await creds.request(API_TOKEN, {
			scope: "device",
			replace: true,
			purpose:
				"For the infra stack to make the tunnel, its DNS record and the Access application, the token lacks permissions it needs.",
			instructions: `Edit the token, or make a new one, with: ${missing.join("; ")}.`,
			task: null,
		});
		fail(
			"requested",
			`${API_TOKEN} lacks: ${missing.join("; ")}. A new one is requested on the Creds page; \`splates creds wait ${API_TOKEN}\`, then run this again.`,
			{ name: API_TOKEN, missing },
		);
	}
	let email = opts.email;
	if (email === "") {
		email = (await accessEmails(api, account, record?.host ?? host)).join(",");
	}
	if (email === "") {
		fail(
			"usage",
			`no email: ${host} has no Access application naming one; pass --email`,
			{ host },
		);
	}
	const projects =
		opts.projects ?? (await originProjects(await opts.registered(), ps));
	if (projects.length === 0) {
		fail(
			"usage",
			"no project to push: none registered here has a GitHub origin; pass --projects slug=owner/repo",
			{},
		);
	}
	const result = await infraInit({
		dir: opts.dir,
		stack: opts.stack,
		host,
		email,
		region: opts.region,
		projects,
		accountId: account,
		zoneId: zone.id,
		...(opts.environment === undefined
			? {}
			: { environment: opts.environment }),
		fs: opts.fs,
	});

	const values = new Map<string, string>();
	const lacking: string[] = [];
	for (const key of result.secrets) {
		const name = SECRET_CREDS[key] as string;
		const value = await creds.credentials.get(name);
		if (value === undefined) {
			lacking.push(key);
			const help = SECRET_HELP[key];
			if (help !== undefined) {
				await creds.request(name, {
					scope: "device",
					task: null,
					...help,
				});
			}
		} else {
			values.set(key, value);
		}
	}
	if (values.size > 0) {
		const run = async (argv: string[], stdin?: string) => {
			const out = await ps.spawnCapture(argv, {
				cwd: opts.dir,
				...(stdin === undefined ? { stdin: "" } : { stdin }),
			});
			if (out.exitCode !== 0) {
				fail(
					"usage",
					`\`${argv.join(" ")}\` in ${opts.dir} failed: ${out.stderr.trim().split("\n").at(-1) ?? ""}`,
					{ dir: opts.dir },
				);
			}
		};
		await run(["pulumi", "stack", "select", "--create", opts.stack]);
		for (const [key, value] of values) {
			await run(
				["pulumi", "config", "set", "--secret", "--stack", opts.stack, key],
				value,
			);
		}
	}
	if (lacking.length > 0) {
		const names = lacking.map((key) => SECRET_CREDS[key]).join(", ");
		fail(
			"requested",
			`still needed: ${names}, requested on the Creds page of \`splates server\` where the setup can. Save them (\`splates creds wait <NAME>\`), then run this again.`,
			{ names: lacking.map((key) => SECRET_CREDS[key]) },
		);
	}
	return { ...result, secrets: lacking, todo: [] };
}

/** How to get each cred a stack secret is kept as, as its request shows. */
const SECRET_HELP: Record<string, { purpose: string; instructions: string }> = {
	"github:token": {
		purpose:
			"For the infra stack to make a deploy key on each project's GitHub repository, so the coordinator's box can clone and push trunk.",
		instructions: [
			"1. Open [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).",
			"2. Pick every owner and repository your splates projects are on (one token per owner if they differ), and give **Administration: Read and write**.",
			"3. Generate it and paste it here.",
		].join("\n"),
	},
	"splates:anthropicKey": {
		purpose:
			"For the coordinator's box, so agents that run there can reach Anthropic.",
		instructions: [
			"1. Open [API keys](https://console.anthropic.com/settings/keys), then **Create Key**.",
			"2. Paste it here.",
		].join("\n"),
	},
};
