import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Ps } from "webappwiz/system";
import { type SecretStores, SYSTEM_STORES } from "./creds";
import { MACHINE_HOME, SLOT } from "./dev-slot";
import { arborHome } from "./roster";
import { SavedTunnel } from "./saved-tunnel";
import { type Slot, Slots } from "./slots";

/**
 * An `arbor dev` on this machine the page can switch to: the machine's own,
 * reached at the host `arbor tunnel setup` made, or a slot's.
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
 * Every `arbor dev` this machine has a host for: its own, then each slot a
 * checkout that still exists holds, in the pool's order, whether or not it
 * runs. Read from the machine's home, which a slot's server is told of, since
 * its own `ARBOR_HOME` is the slot's.
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
	const home = ps.env(MACHINE_HOME) ?? arborHome(ps);
	const here = ps.env(SLOT) ?? null;
	const hostOf = (path: string) =>
		new SavedTunnel(path, { fs, store: secrets.device })
			.read()
			.then((record) => record?.host ?? null);
	const servers: ServerChoice[] = [];
	const machine = await hostOf(`${home}/tunnel.json`);
	if (machine !== null) {
		servers.push({
			slot: null,
			url: `https://${machine}`,
			tree: null,
			here: here === null,
		});
	}
	const slots = new Slots(`${home}/slots.json`, {
		fs,
		ps,
		lock: new FileLock(`${home}/slots.lock`, { fs, ps, log }),
	});
	for (const { slot, tree } of await slots.list()) {
		const host = await hostOf(`${slots.home(slot)}/tunnel.json`);
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
