import type { SecretStore } from "webappwiz/creds";
import type { Fs } from "webappwiz/system";
import { FsStorage, type Storage } from "../storage";
import { SavedTunnel, type TunnelRecord } from "./saved";

/**
 * What names a directory `splates server deploy` puts this machine's
 * records aside in, the tunnel's among them.
 */
const ASIDE = "moved-";

/** Where a move at `stamp` puts this machine's coordinator records aside, kept. */
export function asideOf(home: string, stamp: string): string {
	return `${home}/${ASIDE}${stamp}`;
}

/**
 * The machine's tunnel, as `splates tunnel setup` saved it: in `home`, or,
 * once the coordinator moved onto its box and took the tunnel with it, as
 * the last move put it aside, still naming the zone and Access team the
 * box serves under. Null when neither holds one.
 */
export async function machineTunnel({
	fs,
	home,
	store,
	storage = new FsStorage(home, fs),
}: {
	fs: Fs;
	home: string;
	store: SecretStore;
	storage?: Storage;
}): Promise<TunnelRecord | null> {
	const read = (storage: Storage) => SavedTunnel.in(storage, store).read();
	const own = await read(storage);
	if (own !== null) {
		return own;
	}
	const names = await storage.children("");
	// Each stamp is an ISO time, so the last by name is the last move.
	const last = names
		.filter((each) => each.startsWith(ASIDE))
		.sort()
		.at(-1);
	return last === undefined ? null : read(storage.within(last));
}
