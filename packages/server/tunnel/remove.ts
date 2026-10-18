import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { z } from "zod";
import type { Creds } from "../creds";
import { Exit, fail } from "../exit";
import { SLOTS_APP } from "../ports";
import { tokensOf } from "../workers/cloudflare-access";
import type { CloudflareApi } from "./cloudflare-api";
import { CloudflareError } from "./cloudflare-error";
import { type SavedTunnel, TUNNEL_TOKEN, type TunnelRecord } from "./saved";
import {
	API_TOKEN,
	App,
	CloudflareTunnels,
	Policy,
	workersPolicy,
} from "./setup";

/** What `splates tunnel remove` is asked to remove, and what it runs with. */
export interface RemoveOptions {
	/** The tunnel `splates tunnel setup` saved for this machine. */
	saved: SavedTunnel;
	/** Each slot home's tunnel, in the pool's order, whether or not it has one. */
	slots: SavedTunnel[];
	/** Where the API token is read from, and the tunnels' tokens forgotten. */
	creds: Creds;
	/** The task asking, for the request to name; null outside any. */
	task: string | null;
	fs: Fs;
	log: Logger;
	fetch?: typeof fetch;
}

const DnsRecord = z.object({ id: z.string(), content: z.string() });

/**
 * Deletes what `splates tunnel setup` and `splates server --slot` made, by what they
 * saved: each tunnel and the DNS record routing to it, the Access application
 * in front of the machine's host and the one in front of every slot, and the
 * policy they share, and the workers' policy with the service tokens it lets in. Then forgets each saved file and the tunnel token kept
 * for it. What is already gone is passed over, and a file is forgotten only
 * once its tunnel is, so running it again after a failure finishes the job.
 * The Cloudflare API token is kept, for `splates tunnel setup` to use again.
 */
export async function tunnelRemove(opts: RemoveOptions): Promise<void> {
	const { saved, creds, log } = opts;
	const machine = await saved.read();
	const slots: { saved: SavedTunnel; record: TunnelRecord }[] = [];
	for (const home of opts.slots) {
		const record = await home.read();
		if (record !== null) {
			slots.push({ saved: home, record });
		}
	}
	if (machine === null && slots.length === 0) {
		log.info("no tunnel saved, so nothing to remove");
		return;
	}
	const cloudflare = await CloudflareTunnels.open(
		creds,
		(machine ?? slots[0]?.record)?.host ?? "",
		opts.task,
		log,
		opts.fetch,
	);
	const { api } = cloudflare;
	const policies = new Map<string, string>();
	try {
		for (const slot of slots) {
			await removeTunnel(cloudflare, slot.record, log);
			await forget(opts.fs, creds, slot.saved, slot.record.token, log);
		}
		if (machine !== null) {
			const zone = await cloudflare.findZone(machine.host);
			const account = zone.account.id;
			const apps = await api.list(`/accounts/${account}/access/apps`, App);
			const mine = [
				...apps.filter((app) => app.domain === machine.host),
				...apps.filter(
					(app) => app.domain === `*.${zone.name}` && app.name === SLOTS_APP,
				),
			];
			const found = await api.list(
				`/accounts/${account}/access/policies`,
				Policy,
			);
			for (const app of mine) {
				for (const { id } of app.policies) {
					const policy = found.find((each) => each.id === id);
					// Only the policy `tunnel setup` named for the application.
					if (policy !== undefined && policy.name === mine[0]?.name) {
						policies.set(id, policy.name);
					}
				}
				await gone(api, `/accounts/${account}/access/apps/${app.id}`);
				log.info(`${color.green("deleted")} Access application ${app.name}`);
			}
			// The workers' policy and the service tokens it lets in, which
			// `splates worker add` made and nothing else would take back.
			const workers = found.find(
				(each) => each.name === workersPolicy(mine[0]?.name ?? ""),
			);
			if (workers !== undefined && mine[0] !== undefined) {
				for (const id of tokensOf(workers.include)) {
					await gone(api, `/accounts/${account}/access/service_tokens/${id}`);
					log.info(`${color.green("deleted")} worker service token ${id}`);
				}
				if (tokensOf(workers.include).length > 0) {
					log.info(
						"workers joined through the tunnel have lost their access: add them again with `splates worker add` once `splates tunnel setup` is run",
					);
				}
				policies.set(workers.id, workers.name);
			}
			for (const [id, name] of policies) {
				await gone(api, `/accounts/${account}/access/policies/${id}`);
				log.info(`${color.green("deleted")} Access policy ${name}`);
			}
			await removeTunnel(cloudflare, machine, log);
			await forget(opts.fs, creds, saved, TUNNEL_TOKEN, log);
		}
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
				`removing the tunnel stopped: ${error instanceof Error ? error.message : String(error)}`,
				"Run it again to finish what is left.",
				...(refused
					? [
							`When the token lacks a permission, \`splates creds request ${API_TOKEN} --device --replace\` asks for a new one.`,
						]
					: []),
			].join("\n"),
			{},
		);
	}
	log.info(
		`${color.green("removed")} the tunnel; the Cloudflare API token stays in the store as ${API_TOKEN}, for \`splates tunnel setup\` to use again`,
	);
}

/** Deletes a tunnel and the proxied CNAME routing `record.host` to it. */
async function removeTunnel(
	cloudflare: CloudflareTunnels,
	record: TunnelRecord,
	log: Logger,
): Promise<void> {
	const { api } = cloudflare;
	const zone = await cloudflare.findZone(record.host);
	const account = zone.account.id;
	const target = `${record.tunnel}.cfargotunnel.com`;
	const routes = await api.list(
		`/zones/${zone.id}/dns_records?name.exact=${encodeURIComponent(record.host)}`,
		DnsRecord,
	);
	for (const route of routes.filter((each) => each.content === target)) {
		await gone(api, `/zones/${zone.id}/dns_records/${route.id}`);
		log.info(`${color.green("deleted")} the record routing ${record.host}`);
	}
	// A tunnel Cloudflare still sees connected cannot be deleted.
	await gone(
		api,
		`/accounts/${account}/cfd_tunnel/${record.tunnel}/connections`,
	);
	await gone(api, `/accounts/${account}/cfd_tunnel/${record.tunnel}`);
	log.info(`${color.green("deleted")} tunnel for ${record.host}`);
}

/** Deletes `path`, passing over what is not there. */
async function gone(api: CloudflareApi, path: string): Promise<void> {
	try {
		await api.delete(path);
	} catch (error) {
		if (!(error instanceof CloudflareError && error.status === 404)) {
			throw error;
		}
	}
}

/** Forgets a saved tunnel's file and the token kept for it. */
async function forget(
	fs: Fs,
	creds: Creds,
	saved: SavedTunnel,
	token: string | undefined,
	log: Logger,
): Promise<void> {
	await creds.remove(token ?? TUNNEL_TOKEN, "device");
	await fs.rm(saved.path, { force: true });
	log.info(`forgot ${saved.path}`);
}
