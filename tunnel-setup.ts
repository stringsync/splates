import { color, type Logger } from "webappwiz/log";
import { z } from "zod";
import { commaList } from "./arbor-flags";
import { CloudflareApi, CloudflareError } from "./cloudflare-api";
import type { Creds } from "./creds";
import { hostName } from "./dev-tunnel";
import { Exit, fail } from "./exit";
import { type SavedTunnel, TUNNEL_TOKEN } from "./saved-tunnel";

/** What `arbor tunnel setup` is asked to make, and what it runs with. */
export interface SetupOptions {
	/** The public host name, in a zone of the account. */
	host: string;
	/** Who Access lets in, comma separated. */
	email: string;
	/** What the tunnel, the Access application and its policy are called. */
	name: string;
	/**
	 * The Zero Trust team to make, as in `<team>.cloudflareaccess.com`, when
	 * the account has none yet; "" to use the one it has.
	 */
	team: string;
	/** Where the API token is read from, or requested, and the tunnel's token saved. */
	creds: Creds;
	/** The task asking, for the request to name; null outside any. */
	task: string | null;
	/** Where what it made is saved for `arbor dev`. */
	saved: SavedTunnel;
	log: Logger;
	fetch?: typeof fetch;
}

/**
 * Makes everything that carries `host` to `arbor dev` behind Cloudflare
 * Access, through the API alone, with the API token the person pasted as
 * `API_TOKEN`: the Zero Trust organization when the account has none, a
 * tunnel and its token, the DNS record routing `host` to it, and an Access
 * application letting in only `email`. What already exists by name is
 * reused, and changed only where it differs, so running it again is safe,
 * like `arbor init`. Saves what it made, so a bare `arbor dev` runs it.
 *
 * Without the API token, it requests one with instructions for making it,
 * and refuses with `requested`, to run again once it is saved.
 */
export async function tunnelSetup(opts: SetupOptions): Promise<void> {
	const { creds, saved, log } = opts;
	const host = hostName(opts.host);
	const emails = commaList(opts.email);
	if (emails.length === 0 || emails.some((email) => !email.includes("@"))) {
		fail(
			"usage",
			"--email needs the addresses Access lets in, as in --email me@example.com",
			{ email: opts.email },
		);
	}
	const name = opts.name.trim();
	if (name === "") {
		fail("usage", "--name cannot be empty", {});
	}
	const apiToken = await creds.credentials.get(API_TOKEN);
	if (apiToken === undefined) {
		await creds.request(API_TOKEN, {
			scope: "device",
			instructions: tokenInstructions(host),
			task: opts.task,
		});
		fail(
			"requested",
			[
				`${API_TOKEN} is needed to set up ${host}, so it is requested on the Creds page of \`arbor dev\`.`,
				`Say \`## 🔑 Requested ${API_TOKEN}\`, \`arbor creds wait ${API_TOKEN}\`, then run this again.`,
			].join("\n"),
			{ host, name: API_TOKEN },
		);
	}
	const api = new CloudflareApi(apiToken, { fetch: opts.fetch });
	try {
		const zone = await findZone(api, host);
		const account = zone.account.id;
		const team = await ensureTeam(api, account, opts.team.trim(), log);
		const tunnel = await ensureTunnel(api, account, name, log);
		const token = await api.get(
			`/accounts/${account}/cfd_tunnel/${tunnel.id}/token`,
			z.string(),
		);
		await ensureRoute(api, zone.id, host, tunnel.id, log);
		const policy = await ensurePolicy(api, account, name, emails, log);
		const aud = await ensureApp(api, account, name, host, policy, log);
		await creds.save(TUNNEL_TOKEN, token, {
			scope: "device",
			by: "arbor tunnel setup",
		});
		await saved.save({ host, team, aud, tunnel: tunnel.id });
	} catch (error) {
		// A refusal of arbor's own, such as a store it cannot reach, says enough.
		if (error instanceof Exit) {
			throw error;
		}
		const refused =
			error instanceof CloudflareError &&
			(error.status === 401 || error.status === 403);
		fail(
			"cloudflare",
			[
				`setting up ${host} stopped: ${error instanceof Error ? error.message : String(error)}`,
				...(refused
					? [
							`When the token lacks a permission, \`arbor creds request ${API_TOKEN} --device --replace\` asks for a new one.`,
						]
					: []),
			].join("\n"),
			{ host },
		);
	}
	log.info(
		`${color.green("saved")} ${host} in ${saved.path}, its token in the device's store: \`arbor dev\` now serves https://${host} to ${emails.join(", ")}`,
	);
}

/**
 * The cred the Cloudflare API token is kept as, on the device, since the
 * account is the person's. Not `CLOUDFLARE_API_TOKEN`, which scry's Workers
 * AI token goes by in the same store.
 */
export const API_TOKEN = "ARBOR_CLOUDFLARE_API_TOKEN";

/** What the API token has to be allowed, as the dashboard names each. */
export const TOKEN_PERMISSIONS = [
	"Account · Cloudflare Tunnel · Edit",
	"Account · Access: Apps and Policies · Edit",
	"Account · Access: Organizations, Identity Providers, and Groups · Edit",
	"Zone · Zone · Read",
	"Zone · DNS · Edit",
];

/** Where an API token is made. */
export const TOKENS_PAGE = "https://dash.cloudflare.com/profile/api-tokens";

/** How to make the API token, as its request shows on the Creds page. */
function tokenInstructions(host: string): string {
	return [
		`For \`arbor tunnel setup\` to make the tunnel, its DNS record and the Access application for \`${host}\`.`,
		"",
		`1. Open [API Tokens](${TOKENS_PAGE}), then **Create Token** → **Create Custom Token**.`,
		"2. Name it `arbor tunnel`, and add these permissions:",
		...TOKEN_PERMISSIONS.map((permission) => `   - ${permission}`),
		`3. Under **Account Resources** pick your account, and under **Zone Resources** the zone of \`${host}\`.`,
		"4. **Continue to summary** → **Create Token**, and paste it here.",
	].join("\n");
}

/** Where Zero Trust is turned on, once per account, if making a team needs it. */
const ZERO_TRUST = "https://one.dash.cloudflare.com/";

/** How long a sign-in through Access lasts before it asks again. */
const SESSION = "24h";

const Zone = z.object({
	id: z.string(),
	name: z.string(),
	account: z.object({ id: z.string() }),
});

const Organization = z.object({ auth_domain: z.string() });

const Tunnel = z.object({ id: z.string(), name: z.string() });

const DnsRecord = z.object({
	id: z.string(),
	type: z.string(),
	name: z.string(),
	content: z.string(),
	proxied: z.boolean().optional(),
});

const Include = z.array(z.record(z.string(), z.unknown()));

const Policy = z.object({
	id: z.string(),
	name: z.string(),
	decision: z.string(),
	include: Include,
});

const App = z.object({
	id: z.string(),
	domain: z.string().optional(),
	aud: z.string(),
	policies: z.array(z.object({ id: z.string() })).default([]),
});

/** The zone serving `host`: the longest of its suffixes the account has. */
async function findZone(
	api: CloudflareApi,
	host: string,
): Promise<z.infer<typeof Zone>> {
	const labels = host.split(".");
	for (let at = 0; at < labels.length - 1; at++) {
		const name = labels.slice(at).join(".");
		const [zone] = await api.list(
			`/zones?name=${encodeURIComponent(name)}`,
			Zone,
		);
		if (zone !== undefined) {
			return zone;
		}
	}
	throw new Error(
		`no zone the token can read serves ${host}: give it Zone Read and DNS Edit on that zone`,
	);
}

/**
 * The Zero Trust team's name, which Access tokens are issued by: the
 * account's organization's, or `team`'s, made when the account has none.
 */
async function ensureTeam(
	api: CloudflareApi,
	account: string,
	team: string,
	log: Logger,
): Promise<string> {
	const path = `/accounts/${account}/access/organizations`;
	const found = await api
		.get(path, Organization.nullable())
		.catch((error: unknown) => {
			// An account with none answers as not found.
			if (error instanceof CloudflareError && error.status === 404) {
				return null;
			}
			throw error;
		});
	if (found !== null) {
		return teamOf(found);
	}
	if (team === "") {
		throw new Error(
			"the account has no Zero Trust organization yet: run this again with --team <name>, for <name>.cloudflareaccess.com, to make one",
		);
	}
	if (!/^[a-z0-9-]+$/i.test(team)) {
		throw new Error(
			`--team is a name such as my-team, for my-team.cloudflareaccess.com: not ${team}`,
		);
	}
	let made: z.infer<typeof Organization>;
	try {
		made = await api.post(
			path,
			{ name: team, auth_domain: `${team}.cloudflareaccess.com` },
			Organization,
		);
	} catch (error) {
		throw new Error(
			`could not make the Zero Trust organization ${team}: the name may be taken, or the account may need Zero Trust turned on once at ${ZERO_TRUST} (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	log.info(`${color.green("created")} Zero Trust organization ${team}`);
	return teamOf(made);
}

/** The team an organization's `auth_domain` names. */
function teamOf({ auth_domain }: z.infer<typeof Organization>): string {
	return auth_domain.replace(/\.cloudflareaccess\.com$/, "");
}

/**
 * The tunnel called `name`, made when there is none. Configured locally, so
 * `cloudflared` carries the host to whichever port `arbor dev` bound, which
 * its `--url` says, rather than to one the dashboard pins.
 */
async function ensureTunnel(
	api: CloudflareApi,
	account: string,
	name: string,
	log: Logger,
): Promise<z.infer<typeof Tunnel>> {
	const [existing] = await api.list(
		`/accounts/${account}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
		Tunnel,
	);
	if (existing !== undefined) {
		log.info(`tunnel ${name} is already there`);
		return existing;
	}
	const made = await api.post(
		`/accounts/${account}/cfd_tunnel`,
		{ name, config_src: "local" },
		Tunnel,
	);
	log.info(`${color.green("created")} tunnel ${name}`);
	return made;
}

/**
 * The proxied CNAME routing `host` to the tunnel. One already pointing at
 * another tunnel is moved to this one; any other record for `host` is someone
 * else's, and refused rather than replaced.
 */
async function ensureRoute(
	api: CloudflareApi,
	zone: string,
	host: string,
	tunnel: string,
	log: Logger,
): Promise<void> {
	const target = `${tunnel}.cfargotunnel.com`;
	const want = { type: "CNAME", name: host, content: target, proxied: true };
	const records = await api.list(
		`/zones/${zone}/dns_records?name.exact=${encodeURIComponent(host)}`,
		DnsRecord,
	);
	const [record, ...others] = records;
	if (record === undefined) {
		await api.post(`/zones/${zone}/dns_records`, want, DnsRecord);
		log.info(`${color.green("routed")} ${host} to tunnel ${tunnel}`);
		return;
	}
	if (
		others.length > 0 ||
		record.type !== "CNAME" ||
		!record.content.endsWith(".cfargotunnel.com")
	) {
		throw new Error(
			`${host} already has a ${record.type} record pointing at ${record.content}: pick another host, or delete that record first`,
		);
	}
	if (record.content === target && record.proxied === true) {
		log.info(`${host} already routes to tunnel ${tunnel}`);
		return;
	}
	await api.patch(`/zones/${zone}/dns_records/${record.id}`, want, DnsRecord);
	log.info(
		`${color.green("routed")} ${host} to tunnel ${tunnel}, from ${record.content}`,
	);
}

/** The allow policy called `name`, letting in exactly `emails`. */
async function ensurePolicy(
	api: CloudflareApi,
	account: string,
	name: string,
	emails: string[],
	log: Logger,
): Promise<string> {
	const include = emails.map((email) => ({ email: { email } }));
	const want = { name, decision: "allow", include };
	const existing = (
		await api.list(`/accounts/${account}/access/policies`, Policy)
	).find((policy) => policy.name === name);
	if (existing === undefined) {
		const made = await api.post(
			`/accounts/${account}/access/policies`,
			want,
			Policy,
		);
		log.info(
			`${color.green("created")} Access policy ${name} for ${emails.join(", ")}`,
		);
		return made.id;
	}
	if (existing.decision === "allow" && sameEmails(existing.include, emails)) {
		log.info(`Access policy ${name} already lets in ${emails.join(", ")}`);
		return existing.id;
	}
	await api.put(
		`/accounts/${account}/access/policies/${existing.id}`,
		want,
		Policy,
	);
	log.info(
		`${color.green("updated")} Access policy ${name} to let in ${emails.join(", ")}`,
	);
	return existing.id;
}

/** Whether `include` lets in exactly `emails`, and no one else. */
function sameEmails(
	include: z.infer<typeof Include>,
	emails: string[],
): boolean {
	const listed = include.map((rule) => {
		const email = (rule.email as { email?: unknown } | undefined)?.email;
		return typeof email === "string" ? email.toLowerCase() : null;
	});
	const wanted = emails.map((email) => email.toLowerCase());
	return (
		!listed.includes(null) &&
		listed.length === wanted.length &&
		wanted.every((email) => listed.includes(email))
	);
}

/**
 * The self-hosted Access application in front of `host`, guarded by
 * `policy` alone, and its AUD tag, which Cloudflare assigns when it is made.
 */
async function ensureApp(
	api: CloudflareApi,
	account: string,
	name: string,
	host: string,
	policy: string,
	log: Logger,
): Promise<string> {
	const want = {
		type: "self_hosted",
		name,
		domain: host,
		session_duration: SESSION,
		policies: [{ id: policy, precedence: 1 }],
	};
	const existing = (
		await api.list(
			`/accounts/${account}/access/apps?domain=${encodeURIComponent(host)}&exact=true`,
			App,
		)
	).find((app) => app.domain === host);
	if (existing === undefined) {
		const made = await api.post(`/accounts/${account}/access/apps`, want, App);
		log.info(
			`${color.green("created")} Access application ${name} for ${host}`,
		);
		return made.aud;
	}
	if (existing.policies.length === 1 && existing.policies[0]?.id === policy) {
		log.info(`Access application for ${host} is already there`);
		return existing.aud;
	}
	const updated = await api.put(
		`/accounts/${account}/access/apps/${existing.id}`,
		want,
		App,
	);
	log.info(
		`${color.green("updated")} Access application for ${host} to use policy ${name}`,
	);
	return updated.aud;
}
