import { timingSafeEqual } from "node:crypto";
import { availableParallelism, totalmem } from "node:os";
import type { AsyncResource } from "webappwiz/disposable";
import type { Ps } from "webappwiz/system";
import { RUNNING } from "../server/shared";
import { JOBS } from "./job";
import { WorkerJobHost } from "./job-host";
import { WorkerProtocol } from "./protocol";
import { RunnerSocket } from "./runner-socket";
import { WorkerSession } from "./session";

/** A reachable runner serves jobs alone; no agents, calls or terminal channels. */
export class RunnerServer implements AsyncResource {
	private readonly server: Bun.Server<unknown>;
	private readonly connections = new Map<
		Bun.ServerWebSocket<unknown>,
		{ socket: RunnerSocket; session: WorkerSession; ready: boolean }
	>();
	private readonly hosts = new Set<WorkerJobHost>();

	constructor(
		private readonly ps: Ps,
		private readonly opts: RunnerServerOptions,
	) {
		if (opts.secret.length === 0) {
			throw new Error("a runner needs SPLATES_RUNNER_SECRET");
		}
		this.server = Bun.serve({
			port: opts.port,
			hostname: opts.hostname ?? "0.0.0.0",
			fetch: (request, server) => {
				const shown = Buffer.from(request.headers.get("authorization") ?? "");
				const expected = Buffer.from(`Bearer ${opts.secret}`);
				if (
					shown.length !== expected.length ||
					!timingSafeEqual(shown, expected)
				) {
					return new Response("unauthorized", { status: 401 });
				}
				if (new URL(request.url).pathname !== "/api/jobs") {
					return new Response("not found", { status: 404 });
				}
				if (server.upgrade(request, { data: undefined })) {
					return;
				}
				return new Response("a WebSocket is required", { status: 426 });
			},
			websocket: {
				maxPayloadLength: WorkerProtocol.maxPayloadBytes,
				open: (ws) => this.open(ws),
				message: (ws, message) => this.message(ws, message),
				close: (ws) => this.close(ws),
			},
		});
	}

	get port(): number {
		return this.server.port ?? 0;
	}

	async disposeAsync(): Promise<void> {
		for (const ws of this.connections.keys()) {
			this.close(ws);
		}
		await Promise.all([...this.hosts].map((host) => host.disposeAsync()));
		await this.server.stop(true);
	}

	private open(ws: Bun.ServerWebSocket<unknown>): void {
		const socket = new RunnerSocket(ws);
		const session = new WorkerSession("worker", { capabilities: [JOBS] });
		this.connections.set(ws, { socket, session, ready: false });
		session.events.on("channel", (channel) => {
			if (channel.kind !== "job") {
				channel.dispose();
				return;
			}
			try {
				const host = new WorkerJobHost(
					channel,
					session,
					this.ps,
					this.opts.home,
					session.timer,
				);
				this.hosts.add(host);
				channel.events.on("close", () => {
					void host.disposeAsync().finally(() => this.hosts.delete(host));
				});
			} catch {
				channel.dispose();
			}
		});
	}

	private message(
		ws: Bun.ServerWebSocket<unknown>,
		frame: string | Buffer,
	): void {
		const connection = this.connections.get(ws);
		if (!connection) {
			return;
		}
		if (connection.ready) {
			connection.socket.message(frame);
			return;
		}
		// The client installs its hello listener before sending ready, so a
		// greeting cannot be lost between the HTTP upgrade and that listener.
		if (frame !== "ready") {
			connection.socket.dispose();
			return;
		}
		connection.ready = true;
		void connection.session.connect(connection.socket, {
			id: this.opts.id ?? this.ps.hostname,
			info: {
				jobs: true,
				slots: 0,
				platform: this.ps.platform,
				build: RUNNING,
				cpus: availableParallelism(),
				memory: Math.round(totalmem() / 1024 ** 3),
			},
		});
	}

	private close(ws: Bun.ServerWebSocket<unknown>): void {
		const connection = this.connections.get(ws);
		if (!connection) {
			return;
		}
		this.connections.delete(ws);
		connection.session.dispose();
		connection.socket.dispose();
	}
}

/** Where the hosting proxy reaches this runner, and where its warm clones live. */
export interface RunnerServerOptions {
	secret: string;
	/** The name it says in its hello, as its maker knows it; the hostname by default. */
	id?: string;
	home: string;
	port: number;
	hostname?: string;
}
