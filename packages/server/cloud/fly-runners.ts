import { randomBytes } from "node:crypto";
import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import { DEFAULT_RUNNER_IDLE } from "../workers/limits";
import type { WorkerSocket } from "../workers/socket";
import { WebSocketWorkerSocket } from "../workers/websocket-socket";
import bootstrap from "./bootstrap.sh.txt" with { type: "text" };
import type { FlyCloud } from "./fly";
import type { FlyMachine, FlyMachines, FlySize } from "./fly-types";
import { RunnerGone } from "./runner-gone";

/** The env a runner's job server reads its bearer secret from, which the Machines API gives back to whoever holds the Fly token. */
const RUNNER_IDLE = "SPLATES_RUNNER_IDLE";

export const RUNNER_SECRET = "SPLATES_RUNNER_SECRET";

/** The env a runner says its name in, in its hello. */
export const RUNNER_ID = "SPLATES_RUNNER_ID";

/** The header Fly's proxy routes a request to one machine by. */
export const FLY_INSTANCE_HEADER = "fly-force-instance-id";

/** The header a runner waiting for its build answers with, beside a 409. */
export const RUNNER_WAITS_HEADER = "x-splates-runner";

/** Where the runner's job server listens inside the machine. */
const PORT = 8080;

/** Where Fly writes the bootstrap a runner boots into, on whatever image. */
export const BOOTSTRAP_PATH = "/etc/splates/bootstrap.sh";

/** How long a machine has to start and answer before reaching it fails. */
export const REACH_WITHIN = Duration.mins(3);

/** How often a machine not yet answering is asked again. */
const RETRY = Duration.secs(1);

/**
 * The runners of a Fly app, reached through Fly's proxy at
 * `https://<app>.fly.dev` with the machine's id in `fly-force-instance-id`
 * and its bearer secret, by the server and `splates run` alike: nothing
 * dials in, so a runner needs no tunnel or Access token. Each boots
 * `bootstrap.sh.txt`, handed over in the machine's `files`, which fetches the
 * release's compiled binary, so the image needs only sh and curl or wget. A
 * runner made for a checkout waits for the checkout's build, which whoever
 * reaches it first uploads, so the release never stands in for a build it
 * may not speak the protocol of.
 */
export class FlyRunners {
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;

	constructor(
		readonly cloud: FlyMachines &
			Pick<FlyCloud, "appName" | "origin" | "regions">,
		private readonly opts: FlyRunnersOptions,
	) {
		this.wall = opts.wall ?? new SystemWallClock();
		this.wait = opts.wait ?? sleep;
	}

	/** Makes runner `name` of `size`, which stops itself `idle` after its last job, with a fresh secret, answering once Fly has it. */
	async make(
		name: string,
		size: FlySize,
		metadata: Record<string, string>,
		idle: Duration = DEFAULT_RUNNER_IDLE,
	): Promise<FlyMachine> {
		const region = this.cloud.regions[0];
		if (region === undefined) {
			throw new Error("Fly runners need at least one region");
		}
		const binary = await this.opts.boot.binary();
		return await this.cloud.create({
			name,
			size,
			region,
			image: await this.opts.boot.image(),
			env: {
				[RUNNER_SECRET]: randomBytes(32).toString("base64url"),
				[RUNNER_ID]: name,
				[RUNNER_IDLE]: String(idle.ms),
				SPLATES_BINARY_URL: binary.url,
				SPLATES_BINARY_SHA256: binary.sha256,
				...((await this.opts.boot.ownBuild())
					? { SPLATES_AWAIT_BUILD: "1" }
					: {}),
			},
			entrypoint: ["/bin/sh", BOOTSTRAP_PATH],
			files: [
				{
					guest_path: BOOTSTRAP_PATH,
					raw_value: Buffer.from(bootstrap).toString("base64"),
				},
			],
			metadata: { ...metadata, "splates-size": size.name },
			// Kept when stopped, so it starts again in a second and a half;
			// whoever made it destroys it.
			autoDestroy: false,
			persistRootfs: "restart",
			services: [
				{
					protocol: "tcp",
					internal_port: PORT,
					ports: [{ port: 443, handlers: ["tls", "http"] }],
					autostart: false,
					autostop: "off",
				},
			],
		});
	}

	/**
	 * Opens the job channel's socket to machine `id`: starts it when
	 * stopped (waiting out one that is stopping), uploads the build to one that waits for it, and dials once
	 * its job server answers. Throws `RunnerGone` when the machine is no
	 * more, and an error once `REACH_WITHIN` passes without an answer.
	 */
	async reach(id: string, signal?: AbortSignal): Promise<WorkerSocket> {
		const until = this.wall.now() + REACH_WITHIN.ms;
		let machine = await this.cloud.machine(id);
		if (machine === null) {
			throw new RunnerGone(id);
		}
		if (["stopped", "created", "suspended"].includes(machine.state)) {
			await this.cloud.start(id);
		}
		const secret = machine.config.env[RUNNER_SECRET];
		if (secret === undefined) {
			throw new Error(`${machine.name} was made without a runner secret`);
		}
		const url = `${await this.cloud.origin()}/api/jobs`;
		const headers = {
			authorization: `Bearer ${secret}`,
			[FLY_INSTANCE_HEADER]: id,
		};
		let said = "no answer";
		for (;;) {
			signal?.throwIfAborted();
			const answer = await fetch(url, {
				headers,
				...(signal === undefined ? {} : { signal }),
			}).catch((error: unknown) => {
				said = String(error);
				return null;
			});
			if (answer?.status === 426) {
				return await WebSocketWorkerSocket.connect(
					url.replace(/^http/, "ws"),
					headers,
				);
			}
			if (answer?.status === 409 && answer.headers.has(RUNNER_WAITS_HEADER)) {
				await this.upload(url, headers, signal);
				continue;
			}
			if (answer !== null) {
				said = `HTTP ${answer.status}`;
				await answer.body?.cancel();
			}
			if (this.wall.now() >= until) {
				throw new Error(
					`runner ${machine.name} did not answer within ${REACH_WITHIN.mins} minutes: ${said}`,
				);
			}
			await this.wait(RETRY);
			machine = await this.cloud.machine(id);
			if (machine === null) {
				throw new RunnerGone(id);
			}
			// One that was stopping when asked is started once it has stopped.
			if (["stopped", "suspended"].includes(machine.state)) {
				await this.cloud.start(id);
			}
		}
	}

	private async upload(
		url: string,
		headers: Record<string, string>,
		signal: AbortSignal | undefined,
	): Promise<void> {
		if (!(await this.opts.boot.ownBuild())) {
			throw new Error(
				"the runner waits for a checkout's build, and this splates runs a release",
			);
		}
		const answer = await fetch(url.replace(/\/api\/jobs$/, "/api/build"), {
			method: "PUT",
			headers,
			// Gzipped, a fifth of its size: the bootstrap unzips it.
			body: Bun.gzipSync(await this.opts.boot.bundle()),
			...(signal === undefined ? {} : { signal }),
		});
		if (!answer.ok) {
			throw new Error(`the runner refused its build: HTTP ${answer.status}`);
		}
	}
}

/** What a runner boots: the image, the binary its bootstrap fetches, and the build it is handed when this splates runs from a checkout. */
export interface RunnerBoot {
	/** Whether this splates runs from a checkout, whose build a runner must be handed. */
	ownBuild(): Promise<boolean>;
	/** The registry image a runner boots, for this splates's version. */
	image(): Promise<string>;
	/** The release binary the bootstrap fetches, and its sha256; for a checkout, run only as bun. */
	binary(): Promise<RunnerBinary>;
	/** This splates's own build, bundled into one bun script, which the binary runs as bun; asked only with `ownBuild`. */
	bundle(): Promise<Uint8Array<ArrayBuffer>>;
}

/** What `FlyRunners` makes runners from and reaches them with. */
export interface FlyRunnersOptions {
	boot: RunnerBoot;
	wall?: WallClock;
	wait?: (duration: Duration) => Promise<void>;
}

/** Where a runner's bootstrap fetches splates and what it must hash to. */
export interface RunnerBinary {
	url: string;
	sha256: string;
}
