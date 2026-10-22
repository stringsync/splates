import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import {
	type ProvisionedMachine,
	SNAPSHOT_SPLATES,
	SNAPSHOT_USER,
	type Snapshot,
	type SnapshotRecipe,
	type WorkerImage,
	type WorkerProvider,
	type WorkerSpec,
	type WorkerType,
} from "../workers";
import type { CloudProvider, Orderable } from "./provider";

/**
 * Makes workers in a cloud account: each worker a machine tagged with its
 * id, and each platform's snapshot tagged with the platform, so the cloud
 * itself says what splates made. `splates.config.ts` turns it on by naming
 * its `cloud`, which `loadConfig` makes one of.
 */
export class CloudWorkers implements WorkerProvider {
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;
	readonly idleAfter: Duration | undefined;

	constructor(
		private readonly cloud: CloudProvider,
		opts: CloudWorkersOptions = {},
	) {
		this.wall = opts.wall ?? new SystemWallClock();
		this.wait = opts.wait ?? sleep;
		this.idleAfter = opts.idleAfter;
	}

	/** The cloud its bill is pulled as, as `CloudProvider.billing` says. */
	get billing(): string {
		return this.cloud.billing;
	}

	/**
	 * The types orderable now in one of its locations, each at the price the
	 * cloud's API says now, which a runner made of it is counted at.
	 */
	async types(): Promise<WorkerType[]> {
		const orderable = await this.cloud.orderable();
		return this.cloud.defaults.workerTypes
			.filter((type) => this.where(orderable, type.name) !== null)
			.map((type) => ({
				...type,
				dollarsPerHour:
					orderable.get(type.name)?.dollarsPerHour ?? type.dollarsPerHour,
			}));
	}

	async images(): Promise<WorkerImage[]> {
		return this.cloud.snapshotCosts(SNAPSHOT_TAG);
	}

	async snapshot(recipe: SnapshotRecipe): Promise<Snapshot> {
		const { cloud } = this;
		const orderable = await cloud.orderable();
		const builder = cloud.defaults.builderTypes
			.map((type) => ({ type, location: this.where(orderable, type) }))
			.find((each) => each.location !== null);
		if (builder === undefined) {
			throw new Error(
				`no ${cloud.name} type to build a snapshot on can be ordered in ${this.locations().join(", ")} right now`,
			);
		}
		const { platform } = recipe;
		// A build that died midway leaves its builder running, and billed.
		for (const left of await cloud.machines(BUILDER_TAG, platform)) {
			await cloud.delete(left.id);
		}
		const machine = await cloud.create({
			name: `${platform}-snapshot-builder`,
			type: builder.type,
			image: cloud.defaults.image,
			location: builder.location as string,
			userData: buildScript(recipe.script),
			tags: { [BUILDER_TAG]: platform },
		});
		let id: string;
		let builtAt: number;
		try {
			await this.finished(machine.id);
			builtAt = this.wall.now();
			id = await cloud.snapshot(machine.id, {
				description: `splates ${recipe.version} worker`,
				tags: { [SNAPSHOT_TAG]: platform },
			});
		} finally {
			await cloud.delete(machine.id);
		}
		// The new one is made before the old go, so workers always have one.
		for (const old of await cloud.snapshots(SNAPSHOT_TAG, platform)) {
			if (old !== id) {
				await cloud.deleteSnapshot(old);
			}
		}
		return { id, version: recipe.version, builtAt };
	}

	async create(spec: WorkerSpec): Promise<ProvisionedMachine> {
		const { cloud } = this;
		const location = this.where(await cloud.orderable(), spec.type);
		if (location === null) {
			throw new Error(
				`${cloud.name} cannot make a ${spec.type} in ${this.locations().join(", ")} right now`,
			);
		}
		if ((await cloud.machines(WORKER_TAG, spec.id)).length > 0) {
			return { id: spec.id, type: spec.type };
		}
		try {
			await cloud.create({
				name: spec.id,
				type: spec.type,
				image: spec.snapshot ?? cloud.defaults.image,
				location,
				// In the request's body alone, so the join token never reaches an argv or a log.
				userData: bootScript(spec),
				tags: { [WORKER_TAG]: spec.id },
			});
		} catch (error) {
			await this.destroy(spec.id).catch(() => {});
			throw error;
		}
		return { id: spec.id, type: spec.type };
	}

	async destroy(id: string): Promise<void> {
		for (const machine of await this.cloud.machines(WORKER_TAG, id)) {
			await this.cloud.delete(machine.id);
		}
	}

	/** Every machine tagged as a splates worker, as the cloud lists them. */
	async list(): Promise<ProvisionedMachine[]> {
		return (await this.cloud.machines(WORKER_TAG)).map((machine) => ({
			id: machine.tags[WORKER_TAG] ?? machine.name,
			type: machine.type,
		}));
	}

	/** Deletes each snapshot builder older than any build runs, which a build that died left. */
	async sweep(): Promise<string[]> {
		const swept: string[] = [];
		for (const builder of await this.cloud.machines(BUILDER_TAG)) {
			if (this.wall.now() - builder.createdAt > STALE_BUILDER.ms) {
				await this.cloud.delete(builder.id);
				swept.push(`the snapshot builder ${builder.name}`);
			}
		}
		return swept;
	}

	private locations(): readonly string[] {
		return this.cloud.defaults.workerLocations;
	}

	/** The first of its locations where `type` can be ordered, or null. */
	private where(
		orderable: Map<string, Orderable>,
		type: string,
	): string | null {
		const at = orderable.get(type)?.locations;
		return this.locations().find((location) => at?.has(location)) ?? null;
	}

	/** Waits for builder `id` to power off, which its script does once the recipe ran. */
	private async finished(id: string): Promise<void> {
		for (let waited = 0; waited < BUILD_LIMIT.ms; waited += BUILD_POLL.ms) {
			if ((await this.cloud.machine(id))?.status === "off") {
				return;
			}
			await this.wait(BUILD_POLL);
		}
		throw new Error(
			`the snapshot's recipe did not finish within ${BUILD_LIMIT.mins} minutes: its log is /var/log/splates-recipe.log on the builder`,
		);
	}
}

/** The tag every worker splates made carries, its value the worker's id. */
const WORKER_TAG = "splates-worker";

/** The tags of a snapshot's builder and of the snapshot, their value its platform. */
const BUILDER_TAG = "splates-snapshot-builder";
const SNAPSHOT_TAG = "splates-snapshot";

/** How often, and how long, a snapshot's build is watched for its recipe to finish. */
const BUILD_POLL = Duration.secs(15);
const BUILD_LIMIT = Duration.mins(40);

/** How old a builder is past any build, its recipe's limit and the imaging after. */
const STALE_BUILDER = Duration.hrs(1);

/** What a `CloudWorkers` runs on; the real ones by default. */
export interface CloudWorkersOptions {
	wall?: WallClock;
	/** How long an idle worker may stand before it is destroyed at the end of its paid hour; 15 minutes by default. */
	idleAfter?: Duration;
	/** How it waits between looks at a snapshot's build. */
	wait?: (duration: Duration) => Promise<void>;
}

/**
 * The builder's user data: runs the recipe as root, then, only when it
 * succeeded, clears cloud-init so each worker runs its own user data, and
 * powers off for the snapshot to be taken.
 */
function buildScript(recipe: string): string {
	return [
		"#!/bin/sh",
		"cat > /root/splates-recipe.sh <<'SPLATES_RECIPE'",
		recipe.trimEnd(),
		"SPLATES_RECIPE",
		"if sh /root/splates-recipe.sh > /var/log/splates-recipe.log 2>&1; then",
		"  rm /root/splates-recipe.sh",
		"  cloud-init clean --logs",
		"  poweroff",
		"fi",
		"",
	].join("\n");
}

/** Where the clouds' metadata service answers, serving a machine's user data to whoever asks. */
const METADATA_ADDRESS = "169.254.169.254";

/** The PATH systemd gives a service that sets none. */
const SYSTEMD_PATH =
	"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** Where a worker's `join` keeps its key, readable by root alone, for systemd to hand its service. */
const WORKER_HOME = "/etc/splates-worker";

/** How many times, a while apart, a worker tries `join` before giving up, within its token's 15 minutes. */
const JOIN_TRIES = 60;
const JOIN_APART = Duration.secs(10);

/**
 * A worker's user data: `join` as root, tried until the coordinator
 * answers, keeping its key in `WORKER_HOME`; then `boot` as a systemd
 * service of the snapshot's user, started now and again whenever it
 * stops, with that key in its environment, so a restart dials with the key
 * rather than the token `join` spent. A machine that cannot join runs no
 * worker, and placement replaces it once its token has run out. The
 * metadata address, which serves all of this, is closed to the snapshot's
 * user first, agents included.
 */
function bootScript({ join, joinEnv, boot, recipe }: WorkerSpec): string {
	// The snapshot's splates is a bun script, which root's PATH cannot run.
	const bin = SNAPSHOT_SPLATES.slice(0, SNAPSHOT_SPLATES.lastIndexOf("/"));
	return [
		"#!/bin/sh",
		"set -eu",
		...(recipe === null ? [] : stockRecipe(recipe)),
		"umask 077",
		// The metadata service serves this script, join token and all, to any process.
		`iptables -I OUTPUT -d ${METADATA_ADDRESS} -m owner --uid-owner ${SNAPSHOT_USER} -j REJECT`,
		`mkdir -p ${WORKER_HOME}`,
		"tries=0",
		`until env PATH="${bin}:$PATH" SPLATES_HOME=${WORKER_HOME} ${Object.entries(
			joinEnv,
		)
			.map(([name, value]) => shellQuoted(`${name}=${value}`))
			.join(" ")} ${join.map(shellQuoted).join(" ")}; do`,
		"  tries=$((tries + 1))",
		`  [ "$tries" -lt ${JOIN_TRIES} ] || exit 1`,
		`  sleep ${JOIN_APART.secs}`,
		"done",
		"cat > /etc/systemd/system/splates-worker.service <<'SPLATES_UNIT'",
		"[Unit]",
		"Description=splates worker",
		"After=network-online.target",
		"Wants=network-online.target",
		"",
		"[Service]",
		`User=${SNAPSHOT_USER}`,
		// systemd's own PATH leaves out bun's directory, which `splates`'s `#!/usr/bin/env bun` needs.
		`Environment=PATH=${bin}:${SYSTEMD_PATH}`,
		`EnvironmentFile=${WORKER_HOME}/worker.env`,
		`ExecStart=${boot.map(systemdQuoted).join(" ")}`,
		"Restart=always",
		"RestartSec=5",
		"",
		"[Install]",
		"WantedBy=multi-user.target",
		"SPLATES_UNIT",
		"systemctl daemon-reload",
		"systemctl enable --now splates-worker.service",
		"",
	].join("\n");
}

/** Runs the recipe on a machine of the stock image, which must succeed for the worker to start. */
function stockRecipe(recipe: string): string[] {
	return [
		"cat > /root/splates-recipe.sh <<'SPLATES_RECIPE'",
		recipe.trimEnd(),
		"SPLATES_RECIPE",
		"sh /root/splates-recipe.sh > /var/log/splates-recipe.log 2>&1",
		"rm /root/splates-recipe.sh",
	];
}

/** `word` as one argument of a shell command. */
function shellQuoted(word: string): string {
	return `'${word.replaceAll("'", "'\\''")}'`;
}

/** `word` as one argument of a systemd `ExecStart`, which expands `%` and `$` itself. */
function systemdQuoted(word: string): string {
	const escaped = word
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("%", "%%")
		.replaceAll("$", "$$$$");
	return `"${escaped}"`;
}
