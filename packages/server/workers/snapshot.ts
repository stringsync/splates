import type { Logger } from "webappwiz/log";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { z } from "zod";
import { PLAYWRIGHT_MCP } from "../agents";
import { RUNNING } from "../server/shared";
import type { Document } from "../storage";
import type {
	Platform,
	Snapshot,
	SnapshotRecipe,
	WorkerProvider,
} from "./provider";

/** How old a snapshot may get before the next worker waits for a new one, for the updates it lacks. */
export const SNAPSHOT_FRESH = Duration.days(7);

/** How long after a build fails another is not started by a worker's asking. */
const BUILD_BACKOFF = Duration.mins(10);

/** The user a snapshot's worker runs as: agents refuse to run as root. */
export const SNAPSHOT_USER = "splates";

/** The tag a worker snapshot carries in the cloud, its value the platform. */
export const SNAPSHOT_TAG = "splates-snapshot";

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
		// bubblewrap sandboxes each agent (`sandbox.ts`).
		// procps and iproute2 find a task's processes and ports.
		"apt-get install -y --no-install-recommends ca-certificates curl git unzip procps iproute2 bubblewrap iptables",
		`id ${SNAPSHOT_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${SNAPSHOT_USER}`,
		as("curl -fsSL https://bun.sh/install | bash"),
		// Installing splates fills bun's cache (`~/.bun/install/cache`) with its
		// packages, which a job's `bun install` then finds warm.
		as(`${bun}/bun add -g @stringsync/splates@${version}`),
		as(`${bun}/bunx ${PLAYWRIGHT_MCP} install-browser chromium-headless-shell`),
		`${bun}/bunx playwright install-deps chromium`,
		"apt-get clean",
		"rm -rf /var/lib/apt/lists/*",
		"",
	].join("\n");
	return { platform, version, script };
}

/** `splates worker recipe`: prints the Linux recipe for this build. */
export function workerRecipe({ log }: { log: Logger }): void {
	log.info(snapshotRecipe("linux", RUNNING)?.script.trimEnd() ?? "");
}

const Kept = z.record(
	z.string(),
	z.object({ id: z.string(), version: z.string(), builtAt: z.number() }),
);

/** What the snapshot record holds, by platform. */
export type KeptSnapshots = z.infer<typeof Kept>;

/**
 * The snapshot provisioned workers boot from on each platform, kept at
 * a document across restarts. One is built when a worker is first asked for,
 * and again once splates's version is not the one it installed or it is
 * `SNAPSHOT_FRESH` old, so a worker always boots ready and current.
 */
export class Snapshots {
	private readonly building = new Map<Platform, Promise<Snapshot>>();
	/** When a build on each platform last failed, epoch milliseconds. */
	private readonly failedAt = new Map<Platform, number>();

	private constructor(
		private readonly provider: WorkerProvider,
		private kept: z.infer<typeof Kept>,
		private readonly opts: SnapshotsOptions,
	) {}

	static async open(
		provider: WorkerProvider,
		opts: SnapshotsOptions,
	): Promise<Snapshots> {
		return new Snapshots(provider, await readKept(opts), opts);
	}

	/** The snapshot on `platform` as kept, fresh or not; null before the first. */
	of(platform: Platform): Snapshot | null {
		return this.kept[platform] ?? null;
	}

	/**
	 * The fresh snapshot on `platform`, or null when there is none, in which
	 * case one is built in the background for the next worker, so a worker
	 * need not wait minutes for it: it runs the recipe on a stock image.
	 */
	async ready(platform: Platform): Promise<Snapshot | null> {
		if (this.provider.snapshot === undefined) {
			return null;
		}
		if (this.opts.document !== null) {
			this.kept = await readKept(this.opts);
		}
		const kept = this.of(platform);
		if (kept !== null && this.fresh(kept)) {
			return kept;
		}
		const { wall = new SystemWallClock() } = this.opts;
		const failed = this.failedAt.get(platform);
		if (failed === undefined || wall.now() - failed >= BUILD_BACKOFF.ms) {
			this.refresh(platform).catch((error: unknown) => {
				this.failedAt.set(platform, wall.now());
				this.opts.log?.error(
					`the ${platform} snapshot could not be built: ${String(error)}`,
				);
			});
		}
		return null;
	}

	/** The recipe a worker on `platform` runs when no snapshot is ready; null for no recipe. */
	recipe(platform: Platform): string | null {
		return snapshotRecipe(platform, this.opts.version)?.script ?? null;
	}

	/** The snapshot a worker on `platform` boots from now, built first when there is none fresh. */
	async current(platform: Platform): Promise<Snapshot> {
		// The file is the record: setup may have built one since this was
		// opened, or undone one, deleting its image.
		if (this.opts.document !== null) {
			this.kept = await readKept(this.opts);
		}
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
		if (this.provider.snapshot === undefined) {
			throw new Error(
				"this provider boots registry images and does not build snapshots",
			);
		}
		const built = await this.provider.snapshot(recipe);
		this.kept = { ...this.kept, [platform]: built };
		await this.opts.document?.write(this.kept);
		return built;
	}
}

/**
 * The snapshot kept on `platform` in `opts.document`, fresh or not, without a
 * provider: null before the first, or when the record is unreadable.
 */
export async function keptSnapshot(
	platform: Platform,
	opts: Pick<SnapshotsOptions, "document">,
): Promise<Snapshot | null> {
	return (await readKept(opts))[platform] ?? null;
}

/**
 * Forgets the snapshot kept on `platform` in `opts.document`, answering it, so
 * the next worker builds one again; null when none was kept.
 */
export async function forgetSnapshot(
	platform: Platform,
	opts: Pick<SnapshotsOptions, "document">,
): Promise<Snapshot | null> {
	const kept = await readKept(opts);
	const was = kept[platform] ?? null;
	if (was !== null && opts.document !== null) {
		const { [platform]: _, ...rest } = kept;
		await opts.document.write(rest);
	}
	return was;
}

/** The record in `document`, empty when there is none or it is unreadable, so the next worker builds one again. */
async function readKept({
	document,
}: Pick<SnapshotsOptions, "document">): Promise<z.infer<typeof Kept>> {
	try {
		const read = document === null ? null : await document.read();
		return read === null ? {} : Kept.parse(read);
	} catch {
		return {};
	}
}

/** What `Snapshots` builds for and keeps its record in. */
export interface SnapshotsOptions {
	/** The splates version a snapshot installs: the server's own. */
	version: string;
	/** Where the record is kept; null keeps it in memory alone. */
	document: Document<z.infer<typeof Kept>> | null;
	wall?: WallClock;
	/** Where a background build's failure is told. */
	log?: Logger;
}
