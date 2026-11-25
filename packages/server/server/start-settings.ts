import { SYSTEM_STORES } from "../creds";
import {
	agyInstalled,
	kimiInstalled,
	type Offered,
	RETIRED_AGENTS,
	Roster,
	type RosterAgent,
	splatesHome,
} from "../models";
import { FsStorage } from "../storage";
import {
	type AccessConfig,
	SavedPortsHost,
	SavedTunnel,
	type TunnelConfig,
	type TunnelWildcard,
} from "../tunnel";
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
 * The roster's agents to pick from: the defaults when there is no roster,
 * plus Kimi and Antigravity once each when installed here, and the default
 * models agents offer that the roster lacks.
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
	if (machine !== undefined && (await agyInstalled(machine))) {
		await roster.gain("antigravity");
	}
	if (offered !== undefined) {
		await roster.adopt(await offered.all());
	}
	return (await roster.agents()).filter(
		(each) => !RETIRED_AGENTS.includes(each.id),
	);
}

/**
 * Picks the base host and Access config for task ports and tunnel-exposed rigs:
 * an explicit `--ports-host` flag or saved `ports.json` wins, `--ports-host none`
 * turns it off, and otherwise the main machine server falls back to the saved
 * tunnel's wildcard zone (`*.<zone>` behind `splates-slots`).
 */
export async function resolvePortsTarget(
	opts: PortsTargetOptions,
): Promise<{ portsHost: string | null; portsAccess: AccessConfig | null }> {
	const explicit =
		opts.portsFlag === undefined ? opts.savedPortsHost : opts.portsFlag;
	if (explicit !== null) {
		return { portsHost: explicit, portsAccess: null };
	}
	if (
		opts.portsFlag === null ||
		opts.slotServer ||
		opts.workerless ||
		opts.flagged ||
		opts.access === null ||
		opts.tunnel === null
	) {
		return { portsHost: null, portsAccess: null };
	}
	const wildcard = await opts.ensureWildcard();
	if (wildcard === null) {
		return { portsHost: null, portsAccess: null };
	}
	return {
		portsHost: wildcard.base,
		portsAccess: {
			issuer: opts.access.issuer,
			aud: wildcard.aud,
			extraAuds: [opts.access.aud],
		},
	};
}

/** Inputs to {@link resolvePortsTarget}. */
export interface PortsTargetOptions {
	portsFlag: string | null | undefined;
	savedPortsHost: string | null;
	slotServer: boolean;
	workerless: boolean;
	flagged: boolean;
	access: AccessConfig | null;
	tunnel: TunnelConfig | null;
	ensureWildcard: () => Promise<TunnelWildcard | null>;
}
