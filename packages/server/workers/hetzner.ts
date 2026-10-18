import { type SecretStore, SystemSecretStore } from "webappwiz/creds";
import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import { z } from "zod";
import { splatesHome } from "../models";
import { HCLOUD_TOKEN, HetznerApi } from "./hetzner-api";
import type {
	ProvisionedMachine,
	Snapshot,
	SnapshotRecipe,
	WorkerProvider,
	WorkerSpec,
	WorkerType,
} from "./provider";
import { Pulumi } from "./pulumi";
import { SNAPSHOT_USER } from "./snapshot";

/**
 * Makes workers in the user's own Hetzner Cloud account through Pulumi, as
 * the Cloud workers setup readies it: one stack per worker, in the file
 * backend on this machine, and one per platform for its snapshot. Name it
 * in `splates.config.ts`:
 *
 * ```ts
 * import { HetznerWorkerProvider } from "@stringsync/splates-server/workers";
 *
 * export default { workerProvider: new HetznerWorkerProvider() } satisfies ConfigFile;
 * ```
 */
export class HetznerWorkerProvider implements WorkerProvider {
	private readonly pulumi: Pulumi;
	private readonly locations: readonly string[];
	private readonly store: SecretStore;
	private readonly fetch: typeof globalThis.fetch | undefined;
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;

	constructor(opts: HetznerWorkerProviderOptions = {}) {
		const ps = opts.ps ?? new NodePs();
		this.store = opts.store ?? SystemSecretStore.device();
		this.pulumi = new Pulumi({
			ps,
			fs: opts.fs ?? new NodeFs(),
			home: opts.home ?? splatesHome(ps),
			store: this.store,
		});
		this.locations = opts.locations ?? HETZNER_LOCATIONS;
		this.fetch = opts.fetch;
		this.wall = opts.wall ?? new SystemWallClock();
		this.wait = opts.wait ?? sleep;
	}

	/** The types orderable now in one of its locations. */
	async types(): Promise<WorkerType[]> {
		const orderable = await (await this.api()).orderable();
		return HETZNER_TYPES.filter(
			(type) => this.where(orderable, type.name) !== null,
		);
	}

	async snapshot(recipe: SnapshotRecipe): Promise<Snapshot> {
		const { token, api } = await this.access();
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
		const env = { [HCLOUD_TOKEN]: token };
		const stack = recipe.platform;
		const dir = await this.pulumi.program(SNAPSHOT_PROJECT, {});
		await this.select(dir, stack);
		const kept = await this.kept(dir, stack);
		const up = async (program: SnapshotProgram) => {
			await this.pulumi.program(SNAPSHOT_PROJECT, snapshotProgram(program));
			await this.pulumi.run(dir, upArgs(stack), { env });
			return Outputs.parse(
				JSON.parse(
					await this.pulumi.run(dir, [
						"stack",
						"output",
						"--json",
						"--stack",
						stack,
					]),
				),
			);
		};

		const machine = {
			type: builder.type,
			location: builder.location as string,
			userData: buildScript(recipe.script),
		};
		const built = await up({ builder: machine, kept });
		const builderId = Number(built.builderId);
		try {
			await this.finished(api, String(builderId));
		} catch (error) {
			await up({ kept });
			throw error;
		}
		const builtAt = this.wall.now();
		const fresh = {
			name: `snapshot_${builtAt}`,
			serverId: builderId,
			version: recipe.version,
		};
		// The new one is made before the old goes, so workers always have one.
		await up({ builder: machine, kept: fresh });
		const done = await up({ kept: fresh });
		if (done.snapshotId === undefined) {
			throw new Error("Pulumi made the snapshot but did not say its id");
		}
		return { id: done.snapshotId, version: recipe.version, builtAt };
	}

	async create(spec: WorkerSpec): Promise<ProvisionedMachine> {
		const { token, api } = await this.access();
		const location = this.where(await api.orderable(), spec.type);
		if (location === null) {
			throw new Error(
				`Hetzner cannot make a ${spec.type} in ${this.locations.join(", ")} right now`,
			);
		}
		const env = { [HCLOUD_TOKEN]: token };
		const dir = await this.pulumi.program(WORKER_PROJECT, WORKER_PROGRAM);
		const stack = spec.id;
		await this.select(dir, stack);
		const set = (key: string, value: string) =>
			this.pulumi.run(dir, ["config", "set", key, value, "--stack", stack]);
		await set("serverType", spec.type);
		await set("image", spec.snapshot);
		await set("location", location);
		// From stdin, so the join token never reaches an argv or a log.
		await this.pulumi.run(
			dir,
			["config", "set", "--secret", "userData", "--stack", stack],
			{ stdin: bootScript(spec.boot) },
		);
		try {
			await this.pulumi.run(dir, upArgs(stack), { env });
		} catch (error) {
			await this.destroy(spec.id).catch(() => {});
			throw error;
		}
		return { id: spec.id, type: spec.type };
	}

	async destroy(id: string): Promise<void> {
		const dir = await this.pulumi.program(WORKER_PROJECT, WORKER_PROGRAM);
		if (!(await this.stacks(dir)).includes(id)) {
			return;
		}
		const { token } = await this.access();
		await this.pulumi.run(
			dir,
			["destroy", "--yes", "--skip-preview", "--stack", id],
			{ env: { [HCLOUD_TOKEN]: token } },
		);
		await this.pulumi.run(dir, ["stack", "rm", "--yes", id]);
	}

	/** Every server labelled as a splates worker, as Hetzner lists them. */
	async list(): Promise<ProvisionedMachine[]> {
		return (await (await this.api()).labelled(WORKER_LABEL)).map((server) => ({
			id: server.value,
			type: server.type,
		}));
	}

	/** The first of its locations where `type` can be ordered, or null. */
	private where(
		orderable: Map<string, Set<string>>,
		type: string,
	): string | null {
		const at = orderable.get(type);
		return this.locations.find((location) => at?.has(location)) ?? null;
	}

	private async access(): Promise<{ token: string; api: HetznerApi }> {
		const token = await this.store.get(HCLOUD_TOKEN);
		if (token === undefined) {
			throw new Error(
				`no Hetzner Cloud API token: do the setup step \`hetzner-token\`, which keeps it as ${HCLOUD_TOKEN}`,
			);
		}
		return { token, api: new HetznerApi(token, this.fetch) };
	}

	private async api(): Promise<HetznerApi> {
		return (await this.access()).api;
	}

	/** Selects stack `name` of the project in `dir`, making it first if there is none. */
	private async select(dir: string, name: string): Promise<void> {
		await this.pulumi.run(dir, [
			"stack",
			"select",
			"--create",
			"--secrets-provider",
			"passphrase",
			name,
		]);
	}

	private async stacks(dir: string): Promise<string[]> {
		const listed = StackList.parse(
			JSON.parse(await this.pulumi.run(dir, ["stack", "ls", "--json"])),
		);
		return listed.map((stack) => stack.name);
	}

	/** The snapshot stack `stack` keeps from its last build, or none. */
	private async kept(dir: string, stack: string): Promise<Kept | undefined> {
		const outputs = Outputs.parse(
			JSON.parse(
				await this.pulumi.run(dir, [
					"stack",
					"output",
					"--json",
					"--stack",
					stack,
				]),
			),
		);
		return outputs.kept;
	}

	/** Waits for builder `id` to power off, which its script does once the recipe ran. */
	private async finished(api: HetznerApi, id: string): Promise<void> {
		for (let waited = 0; waited < BUILD_LIMIT.ms; waited += BUILD_POLL.ms) {
			if ((await api.status(id)) === "off") {
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
	{ name: "cx53", platform: "linux", slots: 8, dollarsPerHour: 0.0561 },
	// 16 shared vCPU, 32 GB.
	{ name: "cpx62", platform: "linux", slots: 8, dollarsPerHour: 0.2452 },
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

/** The hcloud Pulumi provider, pinned so every run plans with the same one. */
const HCLOUD_VERSION = "1.43.1";

/** The label every worker splates made carries, its value the worker's id. */
const WORKER_LABEL = "splates-worker";

/** How often, and how long, a snapshot's build is watched for its recipe to finish. */
const BUILD_POLL = Duration.secs(15);
const BUILD_LIMIT = Duration.mins(40);

/** What a `HetznerWorkerProvider` runs on; the real ones by default. */
export interface HetznerWorkerProviderOptions {
	/** Where workers may go, in the order tried; `HETZNER_LOCATIONS` by default. */
	locations?: readonly string[];
	ps?: Ps;
	fs?: Fs;
	/** splates's home, where Pulumi's CLI and state are. */
	home?: string;
	/** Where `HCLOUD_TOKEN` and Pulumi's passphrase are kept: the device's creds. */
	store?: SecretStore;
	fetch?: typeof globalThis.fetch;
	wall?: WallClock;
	/** How a snapshot's build waits between looks. */
	wait?: (duration: Duration) => Promise<void>;
}

const WORKER_PROJECT = "splates-worker";
const SNAPSHOT_PROJECT = "splates-snapshot";

const Kept = z.object({
	name: z.string(),
	serverId: z.number(),
	version: z.string(),
});
type Kept = z.infer<typeof Kept>;

const Outputs = z.object({
	builderId: z.string().optional(),
	snapshotId: z.string().optional(),
	kept: Kept.optional(),
});

const StackList = z.array(z.object({ name: z.string() }));

/** A Pulumi YAML interpolation of `name`, as `${server.id}`. */
function ref(name: string): string {
	return `\${${name}}`;
}

function upArgs(stack: string): string[] {
	return ["up", "--yes", "--skip-preview", "--stack", stack];
}

/** A worker's stack: one server from the snapshot, which runs `userData` once booted. */
const WORKER_PROGRAM = {
	config: {
		serverType: { type: "string" },
		image: { type: "string" },
		location: { type: "string" },
		userData: { type: "string", secret: true },
	},
	resources: {
		server: {
			type: "hcloud:Server",
			properties: {
				name: ref("pulumi.stack"),
				serverType: ref("serverType"),
				image: ref("image"),
				location: ref("location"),
				userData: ref("userData"),
				labels: { [WORKER_LABEL]: ref("pulumi.stack") },
			},
			options: { version: HCLOUD_VERSION },
		},
	},
	outputs: { serverId: ref("server.id") },
};

/** What a snapshot stack holds at one step of a build. */
interface SnapshotProgram {
	builder?: { type: string; location: string; userData: string };
	kept?: Kept;
}

/**
 * A snapshot stack's program: the builder while one runs, and the snapshot
 * kept, by the server it was taken of, which stays its input once that
 * server is gone so Pulumi leaves it be.
 */
function snapshotProgram({ builder, kept }: SnapshotProgram): object {
	const resources: Record<string, object> = {};
	const outputs: Record<string, unknown> = {};
	if (builder !== undefined) {
		resources.builder = {
			type: "hcloud:Server",
			properties: {
				name: `${ref("pulumi.stack")}-snapshot-builder`,
				serverType: builder.type,
				image: BASE_IMAGE,
				location: builder.location,
				userData: builder.userData,
				labels: { "splates-snapshot-builder": ref("pulumi.stack") },
			},
			options: { version: HCLOUD_VERSION },
		};
		outputs.builderId = ref("builder.id");
	}
	if (kept !== undefined) {
		resources[kept.name] = {
			type: "hcloud:Snapshot",
			properties: {
				serverId: kept.serverId,
				description: `splates ${kept.version} worker`,
				labels: { "splates-snapshot": ref("pulumi.stack") },
			},
			options: { version: HCLOUD_VERSION },
		};
		outputs.snapshotId = ref(`${kept.name}.id`);
		outputs.kept = kept;
	}
	return { resources, outputs };
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
