import { SYSTEM_STORES } from "../creds";
import { Roster, type RosterAgent, splatesHome } from "../models";
import { FsStorage } from "../storage";
import { SavedPortsHost, SavedTunnel } from "../tunnel";
import type { SplatesDeps } from "./runtime-deps";

/** The roster saved for this machine. */
export function rosterOf({ ps, fs }: SplatesDeps): Roster {
	return Roster.in(new FsStorage(splatesHome(ps), fs));
}

/** The base host saved for task ports. */
export function savedPortsHostOf({ ps, fs }: SplatesDeps): SavedPortsHost {
	return SavedPortsHost.in(new FsStorage(`${splatesHome(ps)}`, fs));
}

/** The tunnel saved for this machine. */
export function savedTunnelOf({
	ps,
	fs,
	fetch,
	secrets = SYSTEM_STORES,
}: SplatesDeps): SavedTunnel {
	return SavedTunnel.in(
		new FsStorage(`${splatesHome(ps)}`, fs),
		secrets.device,
		fetch,
	);
}

/** Seeds default agents before reading the roster. */
export async function seeded(roster: Roster): Promise<RosterAgent[]> {
	await roster.seed();
	return roster.agents();
}
