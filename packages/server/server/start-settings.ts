import { SYSTEM_STORES } from "../creds";
import { type Offered, Roster, type RosterAgent, splatesHome } from "../models";
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

/** Seeds default agents, and adds the default models agents offer that the roster lacks, before reading it. */
export async function seeded(
	roster: Roster,
	offered?: Offered,
): Promise<RosterAgent[]> {
	await roster.seed();
	if (offered !== undefined) {
		await roster.adopt(await offered.all());
	}
	return roster.agents();
}
