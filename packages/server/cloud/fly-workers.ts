import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import {
	DEFAULT_JOB_SIZE,
	type JobSize,
	OWN_BUILD_HEADER,
	type ProvisionedMachine,
	runnerSizes,
	SNAPSHOT_SPLATES,
	TypeRefused,
	type WorkerProvider,
	type WorkerSpec,
	type WorkerType,
} from "../workers";
import type { FlyCloud } from "./fly";

/** Makes Fly runners for jobs queued on the server, using the project's CPU and memory requirements. */
export class FlyWorkers implements WorkerProvider {
	readonly billing = "fly";
	private readonly refused = new Map<string, number>();
	private readonly wall: WallClock;
	private readonly job: JobSize;
	constructor(
		private readonly cloud: FlyCloud,
		opts: FlyWorkersOptions = {},
	) {
		this.job = opts.job ?? DEFAULT_JOB_SIZE;
		this.wall = opts.wall ?? new SystemWallClock();
	}

	async types(): Promise<WorkerType[]> {
		return runnerSizes(
			await this.cloud.sizes(),
			this.job,
			(name) => (this.refused.get(name) ?? 0) > this.wall.now(),
		).map((size) => ({ ...size, platform: "linux", slots: 1 }));
	}

	async create(spec: WorkerSpec): Promise<ProvisionedMachine> {
		if ((await this.cloud.list({ "splates-worker": spec.id })).length) {
			return { id: spec.id, type: spec.type };
		}
		const size = (await this.cloud.sizes()).find(
			(size) => size.name === spec.type,
		);
		if (!size) {
			throw new TypeRefused(spec.type, "unknown Fly size");
		}
		const region = this.cloud.regions[0];
		if (!region) {
			throw new Error("Fly runners need at least one region");
		}
		try {
			await this.cloud.create({
				name: spec.id,
				size,
				region,
				image: "ubuntu:24.04",
				env: {
					...spec.joinEnv,
					SPLATES_HOME: "/etc/splates-worker",
					SPLATES_JOIN: JSON.stringify(spec.join),
					SPLATES_BOOT: JSON.stringify(spec.boot),
					SPLATES_BUILD: JSON.stringify(spec.build ?? null),
				},
				cmd: ["sh", "-ec", this.boot(spec)],
				metadata: { "splates-worker": spec.id, "splates-size": spec.type },
				autoDestroy: true,
				persistRootfs: "never",
				services: [],
			});
		} catch (error) {
			if (error instanceof TypeRefused) {
				this.refused.set(spec.type, this.wall.now() + Duration.hrs(1).ms);
			}
			throw error;
		}
		return { id: spec.id, type: spec.type };
	}

	async destroy(id: string): Promise<void> {
		for (const machine of await this.cloud.list({ "splates-worker": id })) {
			await this.cloud.destroy(machine.id);
		}
	}

	async list(): Promise<ProvisionedMachine[]> {
		return (await this.cloud.list())
			.filter(
				(machine) => machine.config.metadata["splates-worker"] !== undefined,
			)
			.map((machine) => ({
				id: machine.config.metadata["splates-worker"] as string,
				type: machine.config.metadata["splates-size"] ?? "",
			}));
	}

	private boot(spec: WorkerSpec): string {
		if (!spec.recipe) {
			throw new Error(
				"Fly dial-in runners need the Linux install recipe until the runner image is wired",
			);
		}
		// Secrets stay in env and in the worker's private key file, never shell source.
		return `${spec.recipe}\nexport PATH=/home/splates/.bun/bin:$PATH\nmkdir -p "$SPLATES_HOME"\nchmod 700 "$SPLATES_HOME"\nexec bun -e '${this.program()}'`;
	}
	private program(): string {
		return `
const join = Bun.spawn(JSON.parse(process.env.SPLATES_JOIN), { env: process.env, stdout: "inherit", stderr: "inherit" });
if (await join.exited !== 0) process.exit(1);
const kept = await Bun.file(process.env.SPLATES_HOME + "/worker.env").text();
const env = { ...process.env, ...Object.fromEntries(kept.trim().split("\\n").map(line => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; })) };
const build = JSON.parse(process.env.SPLATES_BUILD);
if (build) {
  const headers = { "${OWN_BUILD_HEADER}": build.token };
  if (env.SPLATES_WORKER_ACCESS_ID) { headers["CF-Access-Client-Id"] = env.SPLATES_WORKER_ACCESS_ID; headers["CF-Access-Client-Secret"] = env.SPLATES_WORKER_ACCESS_SECRET; }
  const response = await fetch(build.url, { headers });
  if (!response.ok) throw new Error("server build unavailable: " + response.status);
  await Bun.write("${SNAPSHOT_SPLATES}", await response.arrayBuffer());
}
const boot = Bun.spawn(["su", "splates", "-s", "/bin/sh", "-c", ${JSON.stringify('exec "$@"')}, "--", "splates-boot", ...JSON.parse(process.env.SPLATES_BOOT)], { env, stdout: "inherit", stderr: "inherit" });
process.exit(await boot.exited);
`;
	}
}

export interface FlyWorkersOptions {
	job?: JobSize;
	wall?: WallClock;
}
