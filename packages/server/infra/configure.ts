import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import { pulumiOrg } from "../coordinator/access";
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
import { type InfraInitResult, importEnvironment, infraInit } from "./init";
import {
	CLOUDFLARE_PERMISSIONS,
	SECRETS_ENVIRONMENT,
	writeSecretsEnvironment,
} from "./secrets";

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
 * An edit is probed with a POST of an empty body, which makes nothing: a token
 * that can edit gets a 400 for the missing fields, one that can only read a
 * 403. A read, such as the Zero Trust organization the stack reads its team
 * domain from, is probed with a GET.
 */
export async function missingPermissions(
	api: CloudflareApi,
	account: string,
	zone: string,
): Promise<string[]> {
	// In the order of `CLOUDFLARE_PERMISSIONS`, which the step for the stack's own token lists.
	const probes: { path: string; read?: true }[] = [
		{ path: `/accounts/${account}/cfd_tunnel` },
		{ path: `/accounts/${account}/access/apps` },
		{ path: `/accounts/${account}/access/service_tokens` },
		{ path: `/accounts/${account}/access/organizations`, read: true },
		{ path: `/zones/${zone}/dns_records` },
	];
	const missing: string[] = [];
	for (const [at, { path, read }] of probes.entries()) {
		try {
			await (read
				? api.get(path, z.unknown())
				: api.post(path, {}, z.unknown()));
		} catch (error) {
			if (!(error instanceof CloudflareError)) {
				throw error;
			}
			if (error.status === 401 || error.status === 403) {
				missing.push(CLOUDFLARE_PERMISSIONS[at] as string);
			}
		}
	}
	return missing;
}

/**
 * Writes the infra project with everything splates keeps filled in: the
 * projects from the registry, the host and email from the saved tunnel and
 * its Access application, and the Cloudflare ids from the API. The secrets
 * it never sees: it makes the ESC environment `SECRETS_ENVIRONMENT` with a
 * placeholder for each, which the user replaces on the Pulumi site, and has
 * the stack import it.
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

	const org = await pulumiOrg(ps);
	if (org === null) {
		fail("usage", "Pulumi is not logged in here: `pulumi login` first", {});
	}
	try {
		await writeSecretsEnvironment(ps, org, result.secrets);
	} catch (error) {
		fail("usage", error instanceof Error ? error.message : String(error), {});
	}
	const stackFile = `${opts.dir}/Pulumi.${opts.stack}.yaml`;
	if (await importEnvironment(opts.fs, stackFile, SECRETS_ENVIRONMENT)) {
		result.written.push(`Pulumi.${opts.stack}.yaml`);
	}
	return result;
}
