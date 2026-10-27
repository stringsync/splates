import { ConsoleLogger, type Logger } from "webappwiz/log";
import { type Bump, releases } from "webappwiz/ship";
import { type Fs, NodePs, type Ps } from "webappwiz/system";
import { fix } from "./fix";
import { preflight } from "./ship-preflight";

/**
 * The agent skill this repository ships. Projects install it from the
 * release's tag with `bunx skills add`, so stamping it is what has a
 * project's copy say which release it came from.
 */
const SKILL = "skills/splates/SKILL.md";

/** Where `splates ship` passes the release type the person approved. */
const SHIP_BUMP = "SPLATES_SHIP_BUMP";

const BUMPS: readonly Bump[] = ["patch", "minor", "major"];

export interface ShipOptions {
	log?: Logger;
	fs?: Fs;
	ps?: Ps;
	// scry-ignore objects-over-callbacks: the platform's own prompt() is the
	// dependency here, and it is a bare function
	prompt?: (message: string) => string | null;
}

/**
 * Releases the package at the release type `splates ship` approved, a patch
 * when run by hand, with its skill stamped at the same version. A release that died is finished first, at the version it already
 * holds.
 */
export async function ship(opts: ShipOptions = {}): Promise<void> {
	const log = opts.log ?? new ConsoleLogger();
	const ps = opts.ps ?? new NodePs();
	const bump = bumpOf(ps.env(SHIP_BUMP));
	await preflight(ps);
	// The build compiles without checking types, so a typecheck is the only
	// gate there is: run it before anything is stamped or pushed. The suite is
	// not run here; whoever ships is expected to have run it already.
	await fix({ check: true, skipScry: true, log, ps });

	const declared = releases.lockstep(
		await releases.workspace({ fs: opts.fs, ps }),
		releases.skill(SKILL, { fs: opts.fs }),
	);
	await declared.release({
		bump,
		prompt: opts.prompt,
		log,
		fs: opts.fs,
		ps,
	});
}

/** The release type `value` names, patch when unset; throws on any other. */
export function bumpOf(value: string | undefined): Bump {
	if (value === undefined || value === "") {
		return "patch";
	}
	const bump = BUMPS.find((each) => each === value);
	if (bump === undefined) {
		throw new Error(
			`${SHIP_BUMP} must be patch, minor or major, not ${JSON.stringify(value)}`,
		);
	}
	return bump;
}
