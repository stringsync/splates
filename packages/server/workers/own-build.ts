import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import type { Logger } from "webappwiz/log";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { refuse } from "../server/shared";

/**
 * Where a made worker fetches the server's own build: `GET` on the join
 * path, which the tunnel's Access already lets a worker's service token
 * through, so a tunnel set up before this needs no new application.
 */
export const OWN_BUILD_PATH = "/api/workers/join";

/** The header a made worker shows its build token in, kept out of the URL and so out of any log of it. */
export const OWN_BUILD_HEADER = "x-splates-build";

/** How long a build token lets its worker fetch the build: past a boot from a stock image and its recipe. */
export const OWN_BUILD_WITHIN = Duration.mins(45);

/** The CLI's entry in the checkout this server runs from. */
const ENTRY = `${dirname(dirname(import.meta.dirname))}/splates/index.ts`;

/**
 * The build of splates this server runs, for the runners it makes, when it
 * runs from a checkout: the release its version names on npm, which a
 * snapshot installs, may lack what the checkout added, as `jobs` in the
 * hello once did, so every job ran here. Bundled into one file for bun on
 * first ask, from the checkout as it is then, and kept; each runner fetches
 * it with a token of its own, minted as it is made.
 */
export class OwnBuild {
	private readonly wall: WallClock;
	/** Each token minted, and when it stops being taken, epoch milliseconds. */
	private readonly grants = new Map<string, number>();
	private bundling: Promise<string> | null = null;

	constructor(private readonly opts: OwnBuildOptions) {
		this.wall = opts.wall ?? new SystemWallClock();
	}

	/** A token that fetches the build for `OWN_BUILD_WITHIN`, again as often as a worker's boot retries. */
	grant(): string {
		const now = this.wall.now();
		for (const [token, until] of this.grants) {
			if (until <= now) {
				this.grants.delete(token);
			}
		}
		const token = randomBytes(32).toString("base64url");
		this.grants.set(token, now + OWN_BUILD_WITHIN.ms);
		return token;
	}

	/** `GET /api/workers/join` with a build token: the bundle, a bun script. */
	readonly serve = async (request: Request): Promise<Response> => {
		if (!this.granted(request.headers.get(OWN_BUILD_HEADER) ?? "")) {
			return refuse(
				401,
				"unauthorized",
				"that build token is unknown or past its time: a runner fetches the build only as it is made",
			);
		}
		try {
			return new Response(await this.bundle(), {
				headers: { "content-type": "text/javascript" },
			});
		} catch (error) {
			this.opts.log.error(
				`splates could not bundle its own build for a runner: ${String(error)}`,
			);
			return refuse(503, "unavailable", "the build could not be bundled");
		}
	};

	private granted(shown: string): boolean {
		const shownBytes = Buffer.from(shown);
		for (const [token, until] of this.grants) {
			const tokenBytes = Buffer.from(token);
			if (
				until > this.wall.now() &&
				tokenBytes.length === shownBytes.length &&
				timingSafeEqual(tokenBytes, shownBytes)
			) {
				return true;
			}
		}
		return false;
	}

	/** The bundle, made once; tried again on the next ask after a failure. */
	private bundle(): Promise<string> {
		this.bundling ??= this.make().catch((error: unknown) => {
			this.bundling = null;
			throw error;
		});
		return this.bundling;
	}

	private async make(): Promise<string> {
		const built = await Bun.build({
			entrypoints: [this.opts.entry ?? ENTRY],
			target: "bun",
		});
		const [output] = built.outputs;
		if (!built.success || output === undefined) {
			throw new AggregateError(built.logs, "the bundle failed");
		}
		const text = await output.text();
		// Linked as the snapshot's `splates`, it runs by its shebang.
		return text.startsWith("#!") ? text : `#!/usr/bin/env bun\n${text}`;
	}
}

/** What an `OwnBuild` bundles and how it tells of a failure. */
export interface OwnBuildOptions {
	/** The entry bundled; the CLI of the checkout this server runs from by default. */
	entry?: string;
	wall?: WallClock;
	log: Logger;
}
