import { randomBytes } from "node:crypto";
import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import type { WorkerSocket } from "../workers/socket";
import { WebSocketWorkerSocket } from "../workers/websocket-socket";
import type { FlyCloud } from "./fly";
import type { FlyMachine, FlyMachines, FlySize } from "./fly-types";
import { RunnerGone } from "./runner-gone";

/** The env a runner's job server reads its bearer secret from, which the Machines API gives back to whoever holds the Fly token. */
export const RUNNER_SECRET = "SPLATES_RUNNER_SECRET";

/** The env a runner says its name in, in its hello. */
export const RUNNER_ID = "SPLATES_RUNNER_ID";

/** The header Fly's proxy routes a request to one machine by. */
export const FLY_INSTANCE_HEADER = "fly-force-instance-id";

/** The header a runner waiting for its build answers with, beside a 409. */
export const RUNNER_WAITS_HEADER = "x-splates-runner";

/** Where the runner's job server listens inside the machine. */
const PORT = 8080;

/** How long a machine has to start and answer before reaching it fails. */
export const REACH_WITHIN = Duration.mins(3);

/** How often a machine not yet answering is asked again. */
const RETRY = Duration.secs(1);

/**
 * The runners of a Fly app, reached through Fly's proxy at
 * `https://<app>.fly.dev` with the machine's id in `fly-force-instance-id`
 * and its bearer secret, by the server and `splates run` alike: nothing
 * dials in, so a runner needs no tunnel or Access token. A runner made for a
 * checkout boots a small server that waits for the checkout's build, which
 * whoever reaches it first uploads, so the release image never stands in
 * for a build it may not speak the protocol of.
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

	/** Makes runner `name` of `size`, with a fresh secret, answering once Fly has it. */
	async make(
		name: string,
		size: FlySize,
		metadata: Record<string, string>,
	): Promise<FlyMachine> {
		const region = this.cloud.regions[0];
		if (region === undefined) {
			throw new Error("Fly runners need at least one region");
		}
		return await this.cloud.create({
			name,
			size,
			region,
			image: await this.opts.boot.image(),
			env: {
				[RUNNER_SECRET]: randomBytes(32).toString("base64url"),
				[RUNNER_ID]: name,
			},
			...((await this.opts.boot.ownBuild()) ? { entrypoint: AWAIT_BUILD } : {}),
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
	 * stopped, uploads the build to one that waits for it, and dials once
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
			body: await this.opts.boot.bundle(),
			...(signal === undefined ? {} : { signal }),
		});
		if (!answer.ok) {
			throw new Error(`the runner refused its build: HTTP ${answer.status}`);
		}
	}
}

/** What a runner boots: the image, and the build it is handed when this splates runs from a checkout. */
export interface RunnerBoot {
	/** Whether this splates runs from a checkout, whose build a runner must be handed. */
	ownBuild(): Promise<boolean>;
	/** The registry image a runner boots, for this splates's version. */
	image(): Promise<string>;
	/** This splates's own build, bundled into one bun script; asked only with `ownBuild`. */
	bundle(): Promise<Uint8Array<ArrayBuffer>>;
}

/** What `FlyRunners` makes runners from and reaches them with. */
export interface FlyRunnersOptions {
	boot: RunnerBoot;
	wall?: WallClock;
	wait?: (duration: Duration) => Promise<void>;
}

/**
 * What a runner made for a checkout runs in place of the image's
 * entrypoint: a server on the job port that takes the build, with the
 * runner's secret, then runs it as the job server. A build from an earlier
 * boot is never run, since the checkout may have moved on.
 */
const AWAIT_BUILD = [
	"bun",
	"-e",
	`
const { chmodSync, mkdirSync, renameSync, rmSync } = require("node:fs");
const { timingSafeEqual } = require("node:crypto");
const build = "/home/splates/.local/bin/splates-own";
rmSync(build, { force: true });
mkdirSync("/home/splates/.local/bin", { recursive: true });
const expected = Buffer.from("Bearer " + (process.env.${RUNNER_SECRET} ?? ""));
let installed;
const done = new Promise((resolve) => { installed = resolve; });
const server = Bun.serve({
	port: ${PORT},
	hostname: "0.0.0.0",
	maxRequestBodySize: 1024 * 1024 * 1024,
	async fetch(request) {
		const shown = Buffer.from(request.headers.get("authorization") ?? "");
		if (expected.length <= 7 || shown.length !== expected.length || !timingSafeEqual(shown, expected)) {
			return new Response("unauthorized", { status: 401 });
		}
		if (request.method === "PUT" && new URL(request.url).pathname === "/api/build") {
			await Bun.write(build + ".tmp", await request.arrayBuffer());
			chmodSync(build + ".tmp", 0o755);
			renameSync(build + ".tmp", build);
			installed();
			return new Response("installed");
		}
		return new Response("waiting for its build", { status: 409, headers: { "${RUNNER_WAITS_HEADER}": "build" } });
	},
});
await done;
await server.stop();
const serve = Bun.spawn(["bun", build, "runners", "serve"], { stdio: ["inherit", "inherit", "inherit"] });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => serve.kill(signal));
process.exit(await serve.exited);
`,
];
