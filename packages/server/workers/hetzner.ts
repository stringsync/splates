import { type SecretStore, SystemSecretStore } from "webappwiz/creds";
import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import { HCLOUD_TOKEN, HetznerApi } from "./hetzner-api";
import type {
	ProvisionedMachine,
	Snapshot,
	SnapshotRecipe,
	WorkerProvider,
	WorkerSpec,
	WorkerType,
} from "./provider";
import { SNAPSHOT_USER } from "./snapshot";

/**
 * Makes workers in the user's own Hetzner Cloud account, through its API
 * with the token the Cloud workers setup keeps: each worker a server
 * labelled with its id, and each platform's snapshot labelled with the
 * platform, so Hetzner itself says what splates made. Name it in
 * `splates.config.ts`:
 *
 * ```ts
 * import { HetznerWorkerProvider } from "@stringsync/splates-server/workers";
 *
 * export default { workerProvider: new HetznerWorkerProvider() } satisfies ConfigFile;
 * ```
 */
export class HetznerWorkerProvider implements WorkerProvider {
	private readonly locations: readonly string[];
	private readonly store: SecretStore;
	private readonly fetch: typeof globalThis.fetch | undefined;
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;
	readonly idleAfter: Duration | undefined;

	constructor(opts: HetznerWorkerProviderOptions = {}) {
		this.store = opts.store ?? SystemSecretStore.device();
		this.locations = opts.locations ?? HETZNER_LOCATIONS;
		this.fetch = opts.fetch;
		this.wall = opts.wall ?? new SystemWallClock();
		this.wait = opts.wait ?? sleep;
		this.idleAfter = opts.idleAfter;
	}

	/** The types orderable now in one of its locations. */
	async types(): Promise<WorkerType[]> {
		const orderable = await (await this.api()).orderable();
		return HETZNER_TYPES.filter(
			(type) => this.where(orderable, type.name) !== null,
		);
	}

	async snapshot(recipe: SnapshotRecipe): Promise<Snapshot> {
		const api = await this.api();
		const orderable = await api.orderable();
		const builder = BUILDER_TYPES.map((type) => ({
			type,
			location: this.where(orderable, type),
		})).find((each) => each.location !== null);
		if (builder === undefined) {
			throw new Error(
				`no Hetzner type to build a snapshot on can be ordered in ${this.locations.join(", ")} right now`,
			);
		}
		const { platform } = recipe;
		// A build that died midway leaves its builder running, and billed.
		for (const left of await api.servers(`${BUILDER_LABEL}=${platform}`)) {
			await api.deleteServer(left.id);
		}
		const server = await api.createServer({
			name: `${platform}-snapshot-builder`,
			type: builder.type,
			image: BASE_IMAGE,
			location: builder.location as string,
			userData: buildScript(recipe.script),
			labels: { [BUILDER_LABEL]: platform },
		});
		let id: string;
		let builtAt: number;
		try {
			await this.finished(api, server.id);
			builtAt = this.wall.now();
			id = await api.snapshot(server.id, {
				description: `splates ${recipe.version} worker`,
				labels: { [SNAPSHOT_LABEL]: platform },
			});
		} finally {
			await api.deleteServer(server.id);
		}
		// The new one is made before the old go, so workers always have one.
		for (const old of await api.snapshots(`${SNAPSHOT_LABEL}=${platform}`)) {
			if (old !== id) {
				await api.deleteImage(old);
			}
		}
		return { id, version: recipe.version, builtAt };
	}

	async create(spec: WorkerSpec): Promise<ProvisionedMachine> {
		const api = await this.api();
		const location = this.where(await api.orderable(), spec.type);
		if (location === null) {
			throw new Error(
				`Hetzner cannot make a ${spec.type} in ${this.locations.join(", ")} right now`,
			);
		}
		if ((await api.servers(`${WORKER_LABEL}=${spec.id}`)).length > 0) {
			return { id: spec.id, type: spec.type };
		}
		try {
			await api.createServer({
				name: spec.id,
				type: spec.type,
				image: spec.snapshot,
				location,
				// In the request's body alone, so the join token never reaches an argv or a log.
				userData: bootScript(spec.boot),
				labels: { [WORKER_LABEL]: spec.id },
			});
		} catch (error) {
			await this.destroy(spec.id).catch(() => {});
			throw error;
		}
		return { id: spec.id, type: spec.type };
	}

	async destroy(id: string): Promise<void> {
		const api = await this.api();
		for (const server of await api.servers(`${WORKER_LABEL}=${id}`)) {
			await api.deleteServer(server.id);
		}
	}

	/** Every server labelled as a splates worker, as Hetzner lists them. */
	async list(): Promise<ProvisionedMachine[]> {
		return (await (await this.api()).servers(WORKER_LABEL)).map((server) => ({
			id: server.labels[WORKER_LABEL] ?? server.name,
			type: server.type,
		}));
	}

	/** Deletes each snapshot builder older than any build runs, which a build that died left. */
	async sweep(): Promise<string[]> {
		const api = await this.api();
		const swept: string[] = [];
		for (const builder of await api.servers(BUILDER_LABEL)) {
			if (this.wall.now() - builder.createdAt > STALE_BUILDER.ms) {
				await api.deleteServer(builder.id);
				swept.push(`the snapshot builder ${builder.name}`);
			}
		}
		return swept;
	}

	/** The first of its locations where `type` can be ordered, or null. */
	private where(
		orderable: Map<string, Set<string>>,
		type: string,
	): string | null {
		const at = orderable.get(type);
		return this.locations.find((location) => at?.has(location)) ?? null;
	}

	private async api(): Promise<HetznerApi> {
		const token = await this.store.get(HCLOUD_TOKEN);
		if (token === undefined) {
			throw new Error(
				`no Hetzner Cloud API token: do the setup step \`hetzner-token\`, which keeps it as ${HCLOUD_TOKEN}`,
			);
		}
		return new HetznerApi(token, this.fetch, this.wait);
	}

	/** Waits for builder `id` to power off, which its script does once the recipe ran. */
	private async finished(api: HetznerApi, id: string): Promise<void> {
		for (let waited = 0; waited < BUILD_LIMIT.ms; waited += BUILD_POLL.ms) {
			if ((await api.server(id))?.status === "off") {
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
 * The server types splates makes workers of, eight slots each as Sizing in
 * `designs/worker-pool.md` has it. Prices are estimates from Hetzner's EU
 * list prices of 15 June 2026, in US dollars without VAT or IPv4. Hetzner
 * bills each started hour in full, up to the type's monthly price.
 */
export const HETZNER_TYPES: readonly WorkerType[] = [
	// 16 shared vCPU, 32 GB; often not orderable, so offered only while it is.
	{
		name: "cx53",
		platform: "linux",
		slots: 8,
		dollarsPerHour: 0.0561,
		billing: "hour",
	},
	// 16 shared vCPU, 32 GB.
	{
		name: "cpx62",
		platform: "linux",
		slots: 8,
		dollarsPerHour: 0.2452,
		billing: "hour",
	},
];

/** Where workers go, in the order tried: Nuremberg, Falkenstein, Helsinki. */
export const HETZNER_LOCATIONS: readonly string[] = ["nbg1", "fsn1", "hel1"];

/**
 * The types a snapshot is built on, the first orderable taken: the smallest
 * x86 disks, since a snapshot boots only on a disk at least its size.
 */
const BUILDER_TYPES = ["cx23", "cpx22", "cpx32"];

/** The image a snapshot's recipe runs on: Debian or Ubuntu, as the recipe wants. */
const BASE_IMAGE = "ubuntu-24.04";

/** The label every worker splates made carries, its value the worker's id. */
const WORKER_LABEL = "splates-worker";

/** The labels of a snapshot's builder and of the snapshot, their value its platform. */
const BUILDER_LABEL = "splates-snapshot-builder";
const SNAPSHOT_LABEL = "splates-snapshot";

/** How often, and how long, a snapshot's build is watched for its recipe to finish. */
const BUILD_POLL = Duration.secs(15);
const BUILD_LIMIT = Duration.mins(40);

/** How old a builder is past any build, its recipe's limit and the imaging after. */
const STALE_BUILDER = Duration.hrs(1);

/** What a `HetznerWorkerProvider` runs on; the real ones by default. */
export interface HetznerWorkerProviderOptions {
	/** Where workers may go, in the order tried; `HETZNER_LOCATIONS` by default. */
	locations?: readonly string[];
	/** Where `HCLOUD_TOKEN` is kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	wall?: WallClock;
	/** How long an idle worker may stand before it is destroyed at the end of its paid hour; 15 minutes by default. */
	idleAfter?: Duration;
	/** How it waits between looks at a snapshot's build or a Hetzner action. */
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

/**
 * A worker's user data: `boot` as a systemd service of the snapshot's user,
 * started now and again whenever it stops, its unit readable by root alone
 * since it holds the join token.
 */
function bootScript(boot: string[]): string {
	return [
		"#!/bin/sh",
		"set -eu",
		"umask 077",
		"cat > /etc/systemd/system/splates-worker.service <<'SPLATES_UNIT'",
		"[Unit]",
		"Description=splates worker",
		"After=network-online.target",
		"Wants=network-online.target",
		"",
		"[Service]",
		`User=${SNAPSHOT_USER}`,
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

/** `word` as one argument of a systemd `ExecStart`, which expands `%` and `$` itself. */
function systemdQuoted(word: string): string {
	const escaped = word
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("%", "%%")
		.replaceAll("$", "$$$$");
	return `"${escaped}"`;
}
