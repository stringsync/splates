import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import {
	ACCESS_CLIENT_ID_HEADER,
	ACCESS_CLIENT_SECRET_HEADER,
	DEFAULT_JOB_SIZE,
	type JobSize,
	locationOf,
	OWN_BUILD_HEADER,
	type ProvisionedMachine,
	runnerSizes,
	SNAPSHOT_SPLATES,
	SNAPSHOT_TAG,
	SNAPSHOT_USER,
	type Snapshot,
	type SnapshotRecipe,
	TypeRefused,
	WORKER_ACCESS_ID,
	WORKER_ACCESS_SECRET,
	type WorkerImage,
	type WorkerProvider,
	type WorkerSpec,
	type WorkerType,
} from "../workers";
import type { CloudProvider, CloudSize } from "./provider";

/**
 * Makes workers in a cloud account: each worker a machine tagged with its
 * id, and each platform's snapshot tagged with the platform, so the cloud
 * itself says what splates made. `splates.config.ts` turns it on by naming
 * its `cloud`, which `loadConfig` makes one of.
 */
export class CloudWorkers implements WorkerProvider {
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;
	private readonly job: JobSize;
	/** The sizes the cloud refused to make, by name, until when each is left out, epoch ms. */
	private readonly refused = new Map<string, number>();
	readonly idleAfter: Duration | undefined;

	constructor(
		private readonly cloud: CloudProvider,
		opts: CloudWorkersOptions = {},
	) {
		this.wall = opts.wall ?? new SystemWallClock();
		this.wait = opts.wait ?? sleep;
		this.job = opts.job ?? DEFAULT_JOB_SIZE;
		this.idleAfter = opts.idleAfter;
	}

	/** The cloud its bill is pulled as, as `CloudProvider.billing` says. */
	get billing(): string {
		return this.cloud.billing;
	}

	/**
	 * The sizes a runner is made of, the cheapest first: each orderable now
	 * that holds a job and boots the snapshot, up to `MAX_RUNNER_CPUS`, shared or
	 * dedicated, at the price the cloud's API says now, leaving out any it
	 * refused in the last `REFUSED_FOR`.
	 */
	async types(): Promise<WorkerType[]> {
		const now = this.wall.now();
		return runnerSizes(
			await this.cloud.sizes(),
			this.cloud.defaults,
			this.job,
			(name) => (this.refused.get(name) ?? 0) > now,
		).map((size) => ({
			name: size.name,
			platform: "linux",
			slots: 1,
			cpus: size.cpus,
			memory: size.memory,
			dollarsPerHour: size.dollarsPerHour,
			billing: size.billing,
		}));
	}

	async images(): Promise<WorkerImage[]> {
		return this.cloud.snapshotCosts(SNAPSHOT_TAG);
	}

	async snapshot(recipe: SnapshotRecipe): Promise<Snapshot> {
		const { cloud } = this;
		const sizes = new Map(
			(await cloud.sizes()).map((size) => [size.name, size]),
		);
		// A snapshot boots machines only in its own location, so it is built
		// where the cheapest runner would be made, as `pickType` picks one.
		const [runner] = (await this.types()).filter(
			(type) => type.platform === recipe.platform,
		);
		const near = this.where(sizes.get(runner?.name ?? ""));
		const builder = cloud.defaults.builderTypes
			.map((type) => ({
				type,
				location:
					near !== null && sizes.get(type)?.locations.has(near)
						? near
						: this.where(sizes.get(type)),
			}))
			.find((each) => each.location !== null);
		if (builder === undefined) {
			throw new Error(
				`no ${cloud.name} type to build a snapshot on can be ordered in any region right now`,
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
		const location = this.where(
			(await cloud.sizes()).find((size) => size.name === spec.type),
		);
		if (location === null) {
			throw new Error(
				`${cloud.name} cannot make a ${spec.type} in any region right now`,
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
			if (error instanceof TypeRefused) {
				this.refused.set(error.type, this.wall.now() + REFUSED_FOR.ms);
			}
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

	/**
	 * Where a machine of `size` is made: the first of its locations that
	 * stocks it, else the first other that does, by name; null when none does.
	 */
	private where(size: CloudSize | undefined): string | null {
		return locationOf(size, this.cloud.defaults);
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

/**
 * How long a size the cloud refused is left out, after which it is tried
 * again, as once a new account may order bigger sizes.
 */
const REFUSED_FOR = Duration.hrs(1);

/** The tag every worker splates made carries, its value the worker's id. */
const WORKER_TAG = "splates-worker";

/** The tag of a snapshot's builder, its value its platform, as `SNAPSHOT_TAG` is the snapshot's. */
const BUILDER_TAG = "splates-snapshot-builder";

/** How often, and how long, a snapshot's build is watched for its recipe to finish. */
const BUILD_POLL = Duration.secs(15);
const BUILD_LIMIT = Duration.mins(40);

/** How old a builder is past any build, its recipe's limit and the imaging after. */
const STALE_BUILDER = Duration.hrs(1);

/** What a `CloudWorkers` runs on; the real ones by default. */
export interface CloudWorkersOptions {
	/** What one of the project's heavy jobs asks of a runner, which every runner made holds. */
	job?: JobSize;
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
function bootScript({
	join,
	joinEnv,
	boot,
	recipe,
	build,
}: WorkerSpec): string {
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
		...(build == null ? [] : ownBuild(build)),
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

/** Where a worker keeps the server's own build, which its `splates` is linked to. */
const OWN_BUILD_DIR = "/usr/local/lib/splates";

/**
 * Fetches the server's own build with its token and the service token
 * `join` kept, both in a file only root reads rather than in curl's
 * arguments, and links it as the snapshot's `splates`; a fetch that fails
 * says so and leaves the snapshot's release to run.
 */
function ownBuild({ url, token }: { url: string; token: string }): string[] {
	const headers = `${WORKER_HOME}/build-headers`;
	const kept = (name: string) =>
		`"$(sed -n 's/^${name}=//p' ${WORKER_HOME}/worker.env)"`;
	const file = `${OWN_BUILD_DIR}/splates.js`;
	return [
		`printf '%s: %s\\n' ${shellQuoted(OWN_BUILD_HEADER)} ${shellQuoted(token)} > ${headers}`,
		`access_id=${kept(WORKER_ACCESS_ID)}`,
		'if [ -n "$access_id" ]; then',
		`  printf '%s: %s\\n%s: %s\\n' ${ACCESS_CLIENT_ID_HEADER} "$access_id" ${ACCESS_CLIENT_SECRET_HEADER} ${kept(WORKER_ACCESS_SECRET)} >> ${headers}`,
		"fi",
		`mkdir -p ${OWN_BUILD_DIR}`,
		`chmod 755 ${OWN_BUILD_DIR}`,
		`if curl -fsS --retry 5 --retry-all-errors -H @${headers} -o ${file} ${shellQuoted(url)}; then`,
		`  chmod 755 ${file}`,
		`  ln -sf ${file} ${SNAPSHOT_SPLATES}`,
		"else",
		`  echo "splates: the server's own build could not be fetched: the snapshot's release runs instead" >&2`,
		"fi",
		`rm -f ${headers}`,
	];
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
