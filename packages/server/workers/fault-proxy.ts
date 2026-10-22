import { Disposer } from "webappwiz/disposable";
import { Duration, SystemTimer } from "webappwiz/time";

/** Which way bytes go through a `FaultProxy`. */
export type FaultDirection = "toCoordinator" | "toWorker";

interface Leg {
	client: Bun.Socket<Leg>;
	upstream: Bun.Socket<Leg> | null;
	/** What the worker sent before the upstream connection opened. */
	pending: { toCoordinator: Uint8Array[]; toWorker: Uint8Array[] };
	/** Bytes the far side has not taken yet, per socket. */
	queued: Map<Bun.Socket<Leg>, Uint8Array[]>;
	closed: boolean;
}

/**
 * A TCP proxy between a real worker and a real server, for `bun test`:
 * the worker dials `port`, and bytes pass to `upstream` unless a fault says
 * otherwise. It cuts the link, stalls it without closing it (as a half-open
 * connection looks to TCP: bytes wait, and arrive late if it resumes), adds
 * latency, refuses or blackholes new dials, and cuts the next frame in half.
 */
export class FaultProxy {
	private readonly listener: Bun.TCPSocketListener<Leg>;
	private readonly legs = new Set<Leg>();
	private latency = 0;
	private stalled = false;
	private dials: "pass" | "refuse" | "blackhole" = "pass";
	private cutting: FaultDirection | null = null;
	/** Writes held back by `stall`, or by latency, as callbacks. */
	private held: (() => void)[] = [];
	private readonly timers = new Disposer();
	private readonly timer = new SystemTimer();

	private constructor(readonly upstreamPort: number) {
		const proxy = this;
		this.listener = Bun.listen<Leg>({
			hostname: "127.0.0.1",
			port: 0,
			socket: {
				open(client) {
					proxy.accepted(client);
				},
				data(client, data) {
					proxy.forward(client.data, new Uint8Array(data), "client");
				},
				drain(socket) {
					proxy.flush(socket);
				},
				close(client) {
					proxy.hangUp(client.data);
				},
				error(client) {
					proxy.hangUp(client.data);
				},
			},
		});
	}

	/** Proxies to the server listening on `upstream` of this machine's loopback. */
	static listen(upstream: number): FaultProxy {
		return new FaultProxy(upstream);
	}

	/** Where the worker dials. */
	get port(): number {
		return this.listener.port;
	}

	/** Connections open through it now. */
	get open(): number {
		return this.legs.size;
	}

	/** Delays every chunk, in both directions, by `ms` from now on. */
	delay(ms: number): void {
		this.latency = ms;
	}

	/** Holds everything in both directions, with both ends left open. */
	stall(): void {
		this.stalled = true;
	}

	/** Lets what `stall` held through, in order. */
	resume(): void {
		this.stalled = false;
		const held = this.held;
		this.held = [];
		for (const release of held) {
			release();
		}
	}

	/** Hangs up on every connection at once, losing what is on the way. */
	drop(): void {
		this.held = [];
		for (const leg of [...this.legs]) {
			this.hangUp(leg);
		}
	}

	/** Refuses new dials outright, as a closed port does. */
	refuse(): void {
		this.dials = "refuse";
	}

	/** Takes new dials and answers none, as a box that is down does. */
	blackhole(): void {
		this.dials = "blackhole";
	}

	/** Ends `refuse` and `blackhole` for dials from now on. */
	reopen(): void {
		this.dials = "pass";
	}

	/**
	 * Sends half of the next chunk going `direction`, then hangs up: the far
	 * end sees a frame that starts and never ends.
	 */
	cutNextFrame(direction: FaultDirection): void {
		this.cutting = direction;
	}

	dispose(): void {
		this.drop();
		this.timers.dispose();
		this.listener.stop(true);
	}

	private accepted(client: Bun.Socket<Leg>): void {
		const leg: Leg = {
			client,
			upstream: null,
			pending: { toCoordinator: [], toWorker: [] },
			queued: new Map(),
			closed: false,
		};
		client.data = leg;
		if (this.dials === "refuse") {
			leg.closed = true;
			client.terminate();
			return;
		}
		this.legs.add(leg);
		if (this.dials === "blackhole") {
			return;
		}
		void Bun.connect<Leg>({
			hostname: "127.0.0.1",
			port: this.upstreamPort,
			data: leg,
			socket: {
				open: (upstream) => {
					if (leg.closed) {
						upstream.terminate();
						return;
					}
					leg.upstream = upstream;
					const early = leg.pending.toCoordinator.splice(0);
					for (const chunk of early) {
						this.write(upstream, chunk);
					}
				},
				data: (_upstream, data) =>
					this.forward(leg, new Uint8Array(data), "upstream"),
				drain: (upstream) => this.flush(upstream),
				close: () => this.hangUp(leg),
				error: () => this.hangUp(leg),
			},
		}).catch(() => this.hangUp(leg));
	}

	private forward(
		leg: Leg,
		data: Uint8Array,
		side: "client" | "upstream",
	): void {
		const direction: FaultDirection =
			side === "client" ? "toCoordinator" : "toWorker";
		if (this.dials === "blackhole" && leg.upstream === null) {
			return;
		}
		const to = side === "client" ? leg.upstream : leg.client;
		const send = (chunk: Uint8Array): void => {
			if (leg.closed) {
				return;
			}
			if (to === null) {
				leg.pending[direction].push(chunk);
				return;
			}
			this.write(to, chunk);
		};
		if (this.cutting === direction) {
			this.cutting = null;
			send(data.slice(0, Math.max(1, Math.floor(data.length / 2))));
			// Past what the write buffer holds, so the half arrives first.
			this.later(() => this.hangUp(leg), 20);
			return;
		}
		const release = (): void => send(data);
		if (this.stalled) {
			this.held.push(release);
		} else if (this.latency > 0) {
			this.later(
				() => (this.stalled ? this.held.push(release) : release()),
				this.latency,
			);
		} else {
			release();
		}
	}

	private write(socket: Bun.Socket<Leg>, chunk: Uint8Array): void {
		const leg = socket.data;
		const queue = leg.queued.get(socket) ?? [];
		queue.push(chunk);
		leg.queued.set(socket, queue);
		this.flush(socket);
	}

	private flush(socket: Bun.Socket<Leg>): void {
		const queue = socket.data.queued.get(socket);
		while (queue !== undefined && queue.length > 0) {
			const chunk = queue[0] as Uint8Array;
			const wrote = socket.write(chunk);
			if (wrote < chunk.length) {
				queue[0] = chunk.slice(wrote);
				return;
			}
			queue.shift();
		}
	}

	private hangUp(leg: Leg): void {
		if (leg.closed && !this.legs.has(leg)) {
			return;
		}
		leg.closed = true;
		this.legs.delete(leg);
		leg.client.terminate();
		leg.upstream?.terminate();
	}

	private later(run: () => void, ms: number): void {
		this.timers.use(this.timer.setTimeout(run, Duration.ms(ms)));
	}
}
