import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { type Clock, Duration, SystemClock } from "webappwiz/time";
import { ACCESS_COOKIE, ACCESS_HEADER, type Access } from "./dev-access";
import { hostname, LOOPBACK, refuse } from "./dev-http";
import { PortSocket } from "./dev-port-socket";
import type { Served } from "./dev-project";
import type { Connection } from "./dev-sockets";
import { PortForward } from "./port-forward";
import type { RemoteWorker } from "./remote-worker";
import { type PortOwners, type TaskPort, taskPorts } from "./task-ports";

/** One task port, with where to open it. */
export interface PortLink extends TaskPort {
	/** On the coordinator's machine. */
	local: string;
	/** Through the saved base host, behind Access; null with none saved. */
	remote: string | null;
}

/**
 * How long one look at the worker's ports serves: a dev server's page asks
 * for many modules at once, and each would otherwise read the process table.
 */
const FRESH = Duration.secs(2);

/** Headers a hop sets for itself, never passed on. */
const HOP_HEADERS = [
	"connection",
	"keep-alive",
	"proxy-connection",
	"transfer-encoding",
	"upgrade",
	"te",
	"trailer",
];

/** What a WebSocket client sets itself on the way to the task's server. */
const SOCKET_HEADERS = [
	"sec-websocket-key",
	"sec-websocket-version",
	"sec-websocket-extensions",
	"sec-websocket-protocol",
];

/**
 * The ports each task's processes listen on, found on the worker that runs
 * them, as VS Code finds the ports to forward: each one forwarded to a
 * loopback port here, down the worker's socket, and, under a saved base
 * host, served at `<task>-<port>.<base>` to whoever Cloudflare Access lets
 * in, and never without it. DNS and TLS for the base are the operator's.
 */
export class DevTaskPorts implements Resource, Claimer {
	private readonly forwards = new Map<number, PortForward>();
	private looked: { at: Duration; ports: Promise<TaskPort[]> } | null = null;
	private readonly clock: Clock;

	constructor(
		private readonly deps: {
			/** The worker the tasks' agents run on. */
			worker: RemoteWorker;
			/** Each served project's worktrees and agents. */
			owners: () => Promise<PortOwners>;
			/** `<task>-<port>.<base>` is a task port's; null for none. */
			base: string | null;
			/** What lets a request reach a task port, which none does without. */
			access: Access | null;
			log: Logger;
			clock?: Clock;
		},
	) {
		this.clock = deps.clock ?? new SystemClock();
	}

	/** Each port a task serves now, forwarded, with its links. */
	async links(): Promise<PortLink[]> {
		return (await this.look(true)).map((each) => this.link(each));
	}

	/** `GET /api/ports`: `links`, as JSON. */
	readonly list = async (): Promise<Response> =>
		Response.json({ base: this.deps.base, ports: await this.links() });

	/**
	 * Answers `request` when its host is a task port's, proxying it to the
	 * task's server; null for any other host, which the page's routes answer.
	 */
	claim(
		request: Request,
		server: Bun.Server<Connection>,
	): Promise<Response | undefined> | null {
		const host = hostname(request.headers.get("host") ?? "").toLowerCase();
		const { base } = this.deps;
		if (base === null || !host.endsWith(`.${base}`)) {
			return null;
		}
		return this.proxy(request, server, host.slice(0, -base.length - 1));
	}

	dispose(): void {
		for (const forward of this.forwards.values()) {
			forward.dispose();
		}
		this.forwards.clear();
	}

	private async proxy(
		request: Request,
		server: Bun.Server<Connection>,
		label: string,
	): Promise<Response | undefined> {
		const { access } = this.deps;
		if (access === null) {
			return refuse(
				403,
				"forbidden",
				"task ports open only behind Cloudflare Access: give --access-team and --access-aud",
			);
		}
		const verified = await access.verify(request);
		if (verified.refused !== undefined) {
			return refuse(403, "forbidden", verified.refused);
		}
		const named = /^([a-z0-9][a-z0-9-]*)-(\d+)$/.exec(label);
		if (named === null) {
			return refuse(
				404,
				"not_found",
				`'${label}' names no task port: open <task>-<port>.${this.deps.base}`,
			);
		}
		const task = named[1] as string;
		const port = Number(named[2]);
		const found =
			(await this.look(false)).find(
				(each) => each.task === task && each.port === port,
			) ??
			(await this.look(true)).find(
				(each) => each.task === task && each.port === port,
			);
		if (found === undefined) {
			return refuse(
				404,
				"not_found",
				`task '${task}' serves nothing on port ${port} now`,
			);
		}
		const forward = this.forward(port);
		const url = new URL(request.url);
		const target = `${LOOPBACK}:${forward.local}${url.pathname}${url.search}`;
		const headers = passed(request.headers, port, host(request));
		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			for (const name of SOCKET_HEADERS) {
				headers.delete(name);
			}
			const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
				.split(",")
				.map((each) => each.trim())
				.filter(Boolean);
			const socket = await PortSocket.open(
				`ws://${target}`,
				headers,
				protocols,
			);
			if (!(socket instanceof PortSocket)) {
				return refuse(502, "error", `port ${port}: ${socket.refused}`);
			}
			const upgraded = server.upgrade(request, {
				data: socket,
				headers:
					socket.protocol === ""
						? undefined
						: { "sec-websocket-protocol": socket.protocol },
			});
			if (!upgraded) {
				socket.closed();
				return refuse(400, "usage", "the WebSocket upgrade failed");
			}
			return undefined;
		}
		try {
			const answered = await fetch(`http://${target}`, {
				method: request.method,
				headers,
				body: request.body,
				redirect: "manual",
				// Passed on as the server encoded it, with its own headers.
				decompress: false,
			});
			const back = new Headers(answered.headers);
			const location = back.get("location");
			if (location !== null) {
				back.set(
					"location",
					rebased(location, port, `https://${host(request)}`),
				);
			}
			return new Response(answered.body, {
				status: answered.status,
				statusText: answered.statusText,
				headers: back,
			});
		} catch (error) {
			return refuse(
				502,
				"error",
				`task '${task}' did not answer on port ${port}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/** The ports tasks serve: as last seen while fresh, unless `again`. */
	private look(again: boolean): Promise<TaskPort[]> {
		const now = this.clock.now();
		const looked = this.looked;
		if (
			!again &&
			looked !== null &&
			now.subtract(looked.at).isLessThan(FRESH)
		) {
			return looked.ports;
		}
		const ports = this.read();
		this.looked = { at: now, ports };
		// A failed look is not kept, so the next one asks again.
		ports.catch(() => {
			if (this.looked?.ports === ports) {
				this.looked = null;
			}
		});
		return ports;
	}

	private async read(): Promise<TaskPort[]> {
		const { worker } = this.deps;
		const [table, listening, owners] = await Promise.all([
			worker.processes(),
			worker.listening(),
			this.deps.owners(),
		]);
		const ports = taskPorts(table, listening, owners);
		// A port no task serves any more takes its forward with it.
		const served = new Set(ports.map((each) => each.port));
		for (const [port, forward] of this.forwards) {
			if (!served.has(port)) {
				forward.dispose();
				this.forwards.delete(port);
			}
		}
		for (const { port } of ports) {
			this.forward(port);
		}
		return ports;
	}

	/**
	 * The forward to `port` on the worker, made on first use. A local
	 * worker's port is open here already, so its forward takes any port; a
	 * remote one's keeps its number when it is free.
	 */
	private forward(port: number): PortForward {
		let forward = this.forwards.get(port);
		if (forward === undefined) {
			const { worker } = this.deps;
			forward = PortForward.listen(
				worker,
				port,
				worker.kind === "local" ? null : port,
			);
			this.forwards.set(port, forward);
		}
		return forward;
	}

	private link({ task, port }: TaskPort): PortLink {
		const local =
			this.deps.worker.kind === "local" ? port : this.forward(port).local;
		return {
			task,
			port,
			local: `http://localhost:${local}`,
			remote:
				this.deps.base === null
					? null
					: `https://${task}-${port}.${this.deps.base}`,
		};
	}
}

/** The Host the request came to, its port included. */
function host(request: Request): string {
	return request.headers.get("host") ?? "";
}

/**
 * The page's headers, as the task's server should see them: to
 * `localhost:<port>`, as a dev server that checks its host expects, with
 * where it came from in the forwarded headers, and without the Access
 * token, which is arbor's and no business of the task's.
 */
function passed(from: Headers, port: number, came: string): Headers {
	const headers = new Headers(from);
	for (const name of HOP_HEADERS) {
		headers.delete(name);
	}
	headers.delete(ACCESS_HEADER);
	const cookies = (from.get("cookie") ?? "")
		.split(";")
		.map((each) => each.trim())
		.filter((each) => each !== "" && !each.startsWith(`${ACCESS_COOKIE}=`));
	if (cookies.length === 0) {
		headers.delete("cookie");
	} else {
		headers.set("cookie", cookies.join("; "));
	}
	headers.set("host", `localhost:${port}`);
	headers.set("x-forwarded-host", came);
	headers.set("x-forwarded-proto", "https");
	return headers;
}

/** A redirect to the task's own `localhost:<port>`, sent to `origin` instead. */
function rebased(location: string, port: number, origin: string): string {
	for (const own of [`http://localhost:${port}`, `http://127.0.0.1:${port}`]) {
		if (location === own || location.startsWith(`${own}/`)) {
			return `${origin}${location.slice(own.length)}`;
		}
	}
	return location;
}

/** Every served project's worktrees and agents, those that failed to open left out. */
export async function portOwnersOf(
	served: Map<string, Promise<Served>>,
): Promise<PortOwners> {
	const owners: PortOwners = { worktrees: [], agents: [] };
	for (const settled of await Promise.allSettled(served.values())) {
		if (settled.status === "fulfilled") {
			const { worktrees, agents } = await settled.value.portOwners();
			owners.worktrees.push(...worktrees);
			owners.agents.push(...agents);
		}
	}
	return owners;
}

/** What answers a task port's request before the page's routes do. */
export interface Claimer {
	/** Its answer to `request`, or null to leave it to the route. */
	claim(
		request: Request,
		server: Bun.Server<Connection>,
	): Promise<Response | undefined> | null;
}

/**
 * `routes`, each handler asking `claimer` first: Bun matches a route by its
 * path alone, so a task port's `/` would otherwise reach the page's.
 */
export function claimedFirst<Routes extends Record<string, unknown>>(
	routes: Routes,
	claimer: Claimer,
): Routes {
	const wrap =
		(handle: unknown) =>
		(request: Request, server: Bun.Server<Connection>): unknown =>
			claimer.claim(request, server) ??
			(handle as (request: Request, server: Bun.Server<Connection>) => unknown)(
				request,
				server,
			);
	return Object.fromEntries(
		Object.entries(routes).map(([path, route]) => [
			path,
			typeof route === "function"
				? wrap(route)
				: Object.fromEntries(
						Object.entries(route as Record<string, unknown>).map(
							([method, handle]) => [method, wrap(handle)],
						),
					),
		]),
	) as Routes;
}
