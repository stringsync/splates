import { SYSTEM_STORES } from "./creds";
import { Roster, type RosterAgent, splatesHome } from "./roster";
import type { SplatesDeps } from "./runtime-deps";
import { SavedPortsHost } from "./saved-ports-host";
import { SavedTunnel } from "./saved-tunnel";

/** The roster saved for this machine. */
export function rosterOf({ ps, fs }: SplatesDeps): Roster {
	return new Roster(`${splatesHome(ps)}/agents.json`, { fs });
}

/** The base host saved for task ports. */
export function savedPortsHostOf({ ps, fs }: SplatesDeps): SavedPortsHost {
	return new SavedPortsHost(`${splatesHome(ps)}/ports.json`, fs);
}

/** The tunnel saved for this machine. */
export function savedTunnelOf({
	ps,
	fs,
	secrets = SYSTEM_STORES,
}: SplatesDeps): SavedTunnel {
	return new SavedTunnel(`${splatesHome(ps)}/tunnel.json`, {
		fs,
		store: secrets.device,
	});
}

/** Seeds default agents before reading the roster. */
export async function seeded(roster: Roster): Promise<RosterAgent[]> {
	await roster.seed();
	return roster.agents();
}
