import { SYSTEM_STORES } from "../creds";
import {
	kimiInstalled,
	type Offered,
	Roster,
	type RosterAgent,
	splatesHome,
} from "../models";
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

/**
 * The roster's agents, seeded with the defaults when there is none, with Kimi
 * added once when it is installed here, and with the default models agents
 * offer that the roster lacks.
 */
export async function seeded(
	roster: Roster,
	offered?: Offered,
	machine?: Pick<SplatesDeps, "fs" | "ps">,
): Promise<RosterAgent[]> {
	await roster.seed();
	if (machine !== undefined && (await kimiInstalled(machine))) {
		await roster.gain("kimi");
	}
	if (offered !== undefined) {
		await roster.adopt(await offered.all());
	}
	return roster.agents();
}
