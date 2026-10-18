import type { Fs } from "webappwiz/system";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { z } from "zod";
import { PLAYWRIGHT_MCP } from "../agents";
import type { Platform } from "../scheduler";
import type { Snapshot, SnapshotRecipe, WorkerProvider } from "./provider";

/** How old a snapshot may get before the next worker waits for a new one, for the updates it lacks. */
export const SNAPSHOT_FRESH = Duration.days(7);

/** The user a snapshot's worker runs as: agents refuse to run as root. */
export const SNAPSHOT_USER = "splates";

/** Where the recipe installs `splates`, for the boot command to run. */
export const SNAPSHOT_SPLATES = `/home/${SNAPSHOT_USER}/.bun/bin/splates`;

/**
 * The recipe a worker's snapshot is built from on `platform`, installing
 * splates `version`: bun, git, the shared browser's Chromium and what it
 * needs, and splates itself, for the user `SNAPSHOT_USER`, with no
 * credentials, which reach a worker only once it runs. It runs as root on a
 * fresh Debian or Ubuntu machine, so a container image can run it too, as
 * a Dockerfile's `RUN`. Null for a platform with no recipe yet.
 */
export function snapshotRecipe(
	platform: Platform,
	version: string,
): SnapshotRecipe | null {
	if (platform !== "linux") {
		return null;
	}
	const as = (command: string) => `su - ${SNAPSHOT_USER} -c '${command}'`;
	const bun = `/home/${SNAPSHOT_USER}/.bun/bin`;
	const script = [
		"#!/bin/sh",
		"set -eu",
		"export DEBIAN_FRONTEND=noninteractive",
		"apt-get update",
		"apt-get install -y --no-install-recommends ca-certificates curl git unzip",
		`id ${SNAPSHOT_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${SNAPSHOT_USER}`,
		as("curl -fsSL https://bun.sh/install | bash"),
		as(`${bun}/bun add -g @stringsync/splates@${version}`),
		as(`${bun}/bunx ${PLAYWRIGHT_MCP} install-browser chromium-headless-shell`),
		`${bun}/bunx playwright install-deps chromium`,
		"apt-get clean",
		"rm -rf /var/lib/apt/lists/*",
		"",
	].join("\n");
	return { platform, version, script };
}

const Kept = z.record(
	z.string(),
	z.object({ id: z.string(), version: z.string(), builtAt: z.number() }),
);

/**
 * The snapshot provisioned workers boot from on each platform, kept at
 * `path` across restarts. One is built when a worker is first asked for,
 * and again once splates's version is not the one it installed or it is
 * `SNAPSHOT_FRESH` old, so a worker always boots ready and current.
 */
export class Snapshots {
	private readonly building = new Map<Platform, Promise<Snapshot>>();

	private constructor(
		private readonly provider: WorkerProvider,
		private kept: z.infer<typeof Kept>,
		private readonly opts: SnapshotsOptions,
	) {}

	static async open(
		provider: WorkerProvider,
		opts: SnapshotsOptions,
	): Promise<Snapshots> {
		const { path, fs } = opts;
		const read =
			path === null || fs === undefined
				? null
				: await fs.read(path).catch(() => null);
		let kept: z.infer<typeof Kept> = {};
		try {
			kept = read === null ? {} : Kept.parse(JSON.parse(read));
		} catch {
			// Unreadable: the next worker builds one again.
		}
		return new Snapshots(provider, kept, opts);
	}

	/** The snapshot on `platform` as kept, fresh or not; null before the first. */
	of(platform: Platform): Snapshot | null {
		return this.kept[platform] ?? null;
	}

	/** The snapshot a worker on `platform` boots from now, built first when there is none fresh. */
	async current(platform: Platform): Promise<Snapshot> {
		const kept = this.of(platform);
		if (kept !== null && this.fresh(kept)) {
			return kept;
		}
		return this.refresh(platform);
	}

	/** Builds the snapshot on `platform` again, sharing a build already under way. */
	refresh(platform: Platform): Promise<Snapshot> {
		const under = this.building.get(platform);
		if (under !== undefined) {
			return under;
		}
		const build = this.build(platform).finally(() =>
			this.building.delete(platform),
		);
		this.building.set(platform, build);
		return build;
	}

	private fresh(snapshot: Snapshot): boolean {
		const { version, wall = new SystemWallClock() } = this.opts;
		return (
			snapshot.version === version &&
			wall.now() - snapshot.builtAt < SNAPSHOT_FRESH.ms
		);
	}

	private async build(platform: Platform): Promise<Snapshot> {
		const recipe = snapshotRecipe(platform, this.opts.version);
		if (recipe === null) {
			throw new Error(`splates has no snapshot recipe for ${platform} yet`);
		}
		const built = await this.provider.snapshot(recipe);
		this.kept = { ...this.kept, [platform]: built };
		const { path, fs } = this.opts;
		if (path !== null && fs !== undefined) {
			await fs.mkdir(path.slice(0, path.lastIndexOf("/")));
			await fs.write(path, `${JSON.stringify(this.kept)}\n`);
		}
		return built;
	}
}

/** What `Snapshots` builds for and keeps its record in. */
export interface SnapshotsOptions {
	/** The splates version a snapshot installs: the coordinator's own. */
	version: string;
	/** Where the record is kept; null keeps it in memory alone. */
	path: string | null;
	fs?: Fs;
	wall?: WallClock;
}
