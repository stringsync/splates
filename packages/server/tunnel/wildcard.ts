import type { SecretStore } from "core/creds";
import type { Logger } from "core/log";
import { CloudflareApi } from "./cloudflare-api";
import {
	API_TOKEN,
	type SavedTunnel,
	type TunnelRecord,
	type TunnelWildcard,
} from "./saved";
import { App, CloudflareTunnels, SLOTS_APP } from "./setup";

/** What {@link ensureWildcardTunnel} needs to provision `*.<zone>` on an existing machine tunnel. */
export interface WildcardTunnelOptions {
	saved: SavedTunnel;
	store: SecretStore;
	/** Animal words not held by an active `--slot` server whose stale tunnel CNAMEs should be cleared. */
	clearWords?: readonly string[];
	log: Logger;
	fetch?: typeof fetch;
}

/**
 * Ensures a machine's saved tunnel has wildcard DNS (`*.<zone>`) routed to it
 * and the shared wildcard Access application (`splates-slots`) in front of it,
 * clearing any stale tunnel CNAMEs for unheld dev-slot words so rigs served on
 * `<word>.<zone>` are never shadowed by stopped slot tunnels.
 *
 * Returns the saved wildcard config immediately when already recorded. Returns
 * null (without failing) when no machine tunnel or Cloudflare API token is
 * available, or when Cloudflare cannot be reached.
 */
export async function ensureWildcardTunnel(
	opts: WildcardTunnelOptions,
): Promise<TunnelWildcard | null> {
	const { saved, store, clearWords = [], log, fetch } = opts;
	const record = await saved.read().catch(() => null);
	if (record === null || record.account !== undefined) {
		return null;
	}
	if (record.wildcard !== undefined) {
		return record.wildcard;
	}
	const apiToken = await store.get(API_TOKEN).catch(() => undefined);
	if (apiToken === undefined) {
		return null;
	}
	try {
		const cloudflare = CloudflareTunnels.over(
			new CloudflareApi(apiToken, { fetch }),
			log,
		);
		const zone = await cloudflare.findZone(record.host);
		const account = zone.account.id;
		const [policy] = await machinePolicies(
			cloudflare.api,
			account,
			record.host,
		);
		if (policy === undefined) {
			log.error(
				`could not provision *.${zone.name}: no Access application lets anyone into ${record.host}`,
			);
			return null;
		}
		await cloudflare.ensureRoute(zone.id, `*.${zone.name}`, record.tunnel);
		const aud = await cloudflare.ensureApp(
			account,
			SLOTS_APP,
			`*.${zone.name}`,
			[policy],
		);
		for (const word of clearWords) {
			await cloudflare.clearTunnelRoute(zone.id, `${word}.${zone.name}`, {
				exceptTunnel: record.tunnel,
			});
		}
		const wildcard: TunnelWildcard = { base: zone.name, aud };
		await saved.save({ ...record, wildcard });
		return wildcard;
	} catch (error) {
		log.error(
			`could not provision wildcard rig subdomains for ${record.host}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}

/**
 * Clears any stale Cloudflare tunnel CNAME for `<word>.<base>` (pointing at
 * another tunnel, such as a stopped `--slot` server) when the Cloudflare API
 * token is available. Best-effort: never throws.
 */
export async function clearWildcardShadow(
	opts: ClearWildcardShadowOptions,
): Promise<boolean> {
	const { record, word, store, log, fetch } = opts;
	if (record.account !== undefined || record.wildcard === undefined) {
		return false;
	}
	const apiToken = await store.get(API_TOKEN).catch(() => undefined);
	if (apiToken === undefined) {
		return false;
	}
	try {
		const cloudflare = CloudflareTunnels.over(
			new CloudflareApi(apiToken, { fetch }),
			log,
		);
		const zone = await cloudflare.findZone(record.wildcard.base);
		return await cloudflare.clearTunnelRoute(
			zone.id,
			`${word}.${record.wildcard.base}`,
			{ exceptTunnel: record.tunnel },
		);
	} catch (error) {
		log.error(
			`could not clear stale route for ${word}.${record.wildcard.base}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/** The policies of the Access application in front of `host`. */
async function machinePolicies(
	api: CloudflareApi,
	account: string,
	host: string,
): Promise<string[]> {
	const app = (
		await api.list(
			`/accounts/${account}/access/apps?domain=${encodeURIComponent(host)}&exact=true`,
			App,
		)
	).find((each) => each.domain === host);
	return app?.policies.map(({ id }) => id) ?? [];
}

/** Inputs to {@link clearWildcardShadow}. */
export interface ClearWildcardShadowOptions {
	record: TunnelRecord;
	word: string;
	store: SecretStore;
	log: Logger;
	fetch?: typeof fetch;
}
