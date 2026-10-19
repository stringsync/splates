import type { Logger } from "webappwiz/log";
import type { Creds } from "../creds";
import { Exit, fail } from "../exit";
import type { CloudflareApi, SavedTunnel, TunnelRecord } from "../tunnel";
import { App, CloudflareError, CloudflareTunnels } from "../tunnel";
import type { Slot } from "./slots";

/** What the Access application in front of every slot is called. */
export const SLOTS_APP = "splates-slots";

/**
 * Makes what carries `<word>.<zone>` to a slot's `splates server`, beside the
 * tunnel `splates tunnel setup` made, through the API with the same token: the
 * slot's tunnel, `splates-<word>`, the DNS record routing its host to it, and,
 * once for every slot, an Access application in front of `*.<zone>` letting
 * in whom the machine's own lets in. Saves them in the slot's home, so its
 * `splates server` runs them as a bare one runs the machine's, asking the API
 * for the tunnel's token at each start rather than keeping it as a cred. What already exists
 * by name is reused, so running it again is safe.
 */
export async function slotTunnelSetup({
	slot,
	machine,
	creds,
	saved,
	log,
	fetch,
}: {
	slot: Slot;
	/** What `splates tunnel setup` saved, whose zone, team and policy slots share. */
	machine: TunnelRecord;
	creds: Creds;
	/** The slot home's tunnel, saved here. */
	saved: SavedTunnel;
	log: Logger;
	fetch?: typeof globalThis.fetch;
}): Promise<TunnelRecord> {
	const cloudflare = await CloudflareTunnels.open(
		creds,
		machine.host,
		null,
		log,
		fetch,
	);
	const { api } = cloudflare;
	try {
		const zone = await cloudflare.findZone(machine.host);
		const account = zone.account.id;
		const host = `${slot.word}.${zone.name}`;
		const tunnel = await cloudflare.ensureTunnel(
			account,
			`splates-${slot.word}`,
		);
		await cloudflare.ensureRoute(zone.id, host, tunnel.id);
		const [policy] = await machinePolicies(api, account, machine.host);
		if (policy === undefined) {
			throw new Error(
				`no Access application lets anyone into ${machine.host}: run \`splates tunnel setup\` again`,
			);
		}
		const aud = await cloudflare.ensureApp(
			account,
			SLOTS_APP,
			`*.${zone.name}`,
			[policy],
		);
		const record = {
			host,
			team: machine.team,
			aud,
			tunnel: tunnel.id,
			account,
		};
		await saved.save(record);
		return record;
	} catch (error) {
		if (error instanceof Exit) {
			throw error;
		}
		const refused =
			error instanceof CloudflareError &&
			(error.status === 401 || error.status === 403);
		fail(
			"cloudflare",
			[
				`setting up slot ${slot.word} stopped: ${error instanceof Error ? error.message : String(error)}`,
				...(refused
					? [
							"When the token lacks a permission, `splates creds request SPLATES_CLOUDFLARE_API_TOKEN --device --replace` asks for a new one.",
						]
					: []),
			].join("\n"),
			{ slot: slot.word },
		);
	}
}

/** The policies of the Access application `splates tunnel setup` made. */
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
