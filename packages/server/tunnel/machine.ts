import type { SecretStore } from "webappwiz/creds";
import type { Fs } from "webappwiz/system";
import { SavedTunnel, type TunnelRecord } from "./saved";

/**
 * What names a directory `splates coordinator move` puts this machine's
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
}: {
	fs: Fs;
	home: string;
	store: SecretStore;
}): Promise<TunnelRecord | null> {
	const read = (dir: string) =>
		new SavedTunnel(`${dir}/tunnel.json`, { fs, store }).read();
	const own = await read(home);
	if (own !== null) {
		return own;
	}
	const names = await fs.readdir(home).catch(() => []);
	// Each stamp is an ISO time, so the last by name is the last move.
	const last = names
		.filter((each) => each.startsWith(ASIDE))
		.sort()
		.at(-1);
	return last === undefined ? null : read(`${home}/${last}`);
}
