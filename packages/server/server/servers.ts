import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { type SecretStores, SYSTEM_STORES } from "../creds";
import { splatesHome } from "../models";
import { MACHINE_HOME, SLOT, type Slot, Slots } from "../ports";
import { FsStorage } from "../storage";
import { machineTunnel, SavedTunnel } from "../tunnel";

/**
 * A `splates server` the page can switch to: the machine's own, reached at
 * the host `splates tunnel setup` made, on its box once it moved there, or a
 * slot's on this machine.
 */
export interface ServerChoice {
	/** The slot it serves under; null for the machine's own. */
	slot: Slot | null;
	/** Its page, as in https://fox.example.com. */
	url: string;
	/** The checkout that holds the slot; null for the machine's own. */
	tree: string | null;
	/** Whether it is the one serving this page. */
	here: boolean;
}

/**
 * Every `splates server` this machine has a host for: its own, then each slot a
 * checkout that still exists holds, in the pool's order, whether or not it
 * runs. Read from the machine's home, which a slot's server is told of, since
 * its own `SPLATES_HOME` is the slot's.
 */
export async function devServers({
	fs,
	ps,
	log,
	secrets = SYSTEM_STORES,
}: {
	fs: Fs;
	ps: Ps;
	log: Logger;
	secrets?: SecretStores;
}): Promise<ServerChoice[]> {
	const home = ps.env(MACHINE_HOME) ?? splatesHome(ps);
	const here = ps.env(SLOT) ?? null;
	const hostOf = (dir: string) =>
		SavedTunnel.in(new FsStorage(dir, fs), secrets.device)
			.read()
			.then((record) => record?.host ?? null);
	const servers: ServerChoice[] = [];
	// Once the coordinator moved onto its box, its host serves it there.
	const machine =
		(await machineTunnel({ fs, home, store: secrets.device }))?.host ?? null;
	if (machine !== null) {
		servers.push({
			slot: null,
			url: `https://${machine}`,
			tree: null,
			here: here === null,
		});
	}
	const slots = Slots.ofMachine({ fs, ps, log });
	for (const { slot, tree } of await slots.list()) {
		const host = await hostOf(slots.home(slot));
		if (host !== null) {
			servers.push({
				slot,
				url: `https://${host}`,
				tree,
				here: here === slot.word,
			});
		}
	}
	return servers;
}
