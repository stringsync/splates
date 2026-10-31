import { join } from "node:path";
import { ConsoleLogger, type Logger } from "core/log";
import {
	type Bump,
	type DryRun,
	type GithubActions,
	githubActions,
	releases,
} from "core/ship";
import { type Fs, NodePs, type Ps } from "core/system";
import { Duration } from "core/time";
import { MIRROR } from "../mirror";
import { ROOT } from "./root";
import { preflight } from "./ship-preflight";

/**
 * The agent skill this repository ships. Projects install it from the
 * release's tag with `bunx skills add`, so stamping it is what has a
 * project's copy say which release it came from. It is read from mono's root,
 * where the release runs.
 */
const SKILL = "splates/skills/splates/SKILL.md";

/** Where `splates ship` passes the release type the person approved. */
const SHIP_BUMP = "SPLATES_SHIP_BUMP";

const BUMPS: readonly Bump[] = ["patch", "minor", "major"];

/** The repository splates is mirrored to, whose workflow publishes it. */
const REPO = "stringsync/splates";

/** What stringsync/splates's publish workflow runs, from the mirror's root. */
const PUBLISH = "bin/splates dev publish";

/** The package a release publishes, the server folded in. */
const PACKAGES = ["@stringsync/splates"];

export interface ShipOptions {
	log?: Logger;
	fs?: Fs;
	ps?: Ps;
	// vet-ignore objects-over-callbacks: the platform's own prompt() is the
	// dependency here, and it is a bare function
	prompt?: (message: string) => string | null;
	/** Rehearse the release, sending nothing out; see core/ship's `dryRun`. */
	dryRun?: boolean | DryRun;
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
	const via = actions(ps);
	await preflight(ps);

	const declared = releases.lockstep(
		// The push comes first among the preflight steps, so a rejected push
		// stops the typecheck, the stamping, the build and the publish.
		releases.push({ ps }),
		// The build compiles without checking types, so the root checks are the
		// only gate there is: run them before anything is stamped or pushed. The
		// suite is not run here; whoever ships is expected to have run it already.
		releases.step({
			name: "Check",
			stage: "preflight",
			deadline: Duration.mins(10),
			run: async () => {
				const root = join(ROOT, "..");
				const { exitCode } = await ps.spawn(
					[join(root, "bin/mono"), "fix", "--check", "--code-only"],
					{ cwd: root },
				);
				if (exitCode !== 0) {
					throw new Error("bin/mono fix --check failed");
				}
			},
		}),
		// npm gets the build stringsync/splates's publish workflow makes from
		// the mirror's commit, which npm trusts, so nothing logs in or approves.
		...PACKAGES.map((name) => releases.npm(name, { ps, via })),
		releases.skill(SKILL, { fs: opts.fs }),
		// The tag, which `splates init` installs the skill from, and the notes
		// go on the public repository; mono gets no tag.
		releases.github({ repo: "stringsync/splates", ps }),
		// The build happens in the mirror, installed from npm as anyone cloning
		// stringsync/splates would, with the server and the core the cli
		// reaches folded in, since neither is published. The mirror's commit is
		// pushed at the tag stage.
		releases.mirrored({ ...MIRROR, ps, publish: PUBLISH, via }),
	);
	await declared.release({
		bump,
		project: "splates",
		dryRun: opts.dryRun,
		prompt: opts.prompt,
		log,
		fs: opts.fs,
		ps,
	});
}

export interface PublishOptions {
	log?: Logger;
	fs?: Fs;
	ps?: Ps;
}

/**
 * Builds the cli, with the server and the core it reaches folded in, and
 * publishes it at the version the checkout stands at, unless npm has it
 * already. stringsync/splates's publish
 * workflow runs it from a release's mirror commit, as a job npm trusts; it is
 * never run in mono.
 */
export async function publish(opts: PublishOptions = {}): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	await releases
		.lockstep(
			releases.vendor({ fs: opts.fs, ps }),
			...PACKAGES.map((name) => releases.npm(name, { ps })),
		)
		.publish({ log: opts.log, fs: opts.fs, ps });
}

/**
 * Has npm trust stringsync/splates's publish workflow to publish
 * @stringsync/splates. Run once, by the person: npm asks to sign in in a browser.
 */
export async function trust(opts: PublishOptions = {}): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	const via = actions(ps);
	await releases
		.lockstep(...PACKAGES.map((name) => releases.npm(name, { ps, via })))
		.trust({ log: opts.log });
}

function actions(ps: Ps): GithubActions {
	return githubActions({ repo: REPO, ps, trustCommand: "splates dev trust" });
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
