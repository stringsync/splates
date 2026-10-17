// scry-ignore-file compact-files: one end of the link, whose handshake, replay, acks and channel bookkeeping are one state machine
import { Disposer, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	type Clock,
	Duration,
	SystemClock,
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import { WorkerChannel, type WorkerChannelLink } from "./worker-channel";
import { WorkerConnection } from "./worker-connection";
import {
	type ChannelFrame,
	type Frame,
	type Held,
	type Json,
	type Negotiated,
	WorkerProtocol,
} from "./worker-protocol";
import { WorkerReplay } from "./worker-replay";
import type { WorkerSocket } from "./worker-socket";

/** A worker's hello, which the coordinator reads to pick its session. */
export type WorkerHello = Extract<Frame, { type: "hello" }>;

/** What a `WorkerSession` hears. */
export interface WorkerSessionEvents extends Record<string, unknown> {
	/** The other end opened a channel. */
	channel: WorkerChannel;
	/** A handshake settled, and what the other end missed has been sent again. */
	connected: undefined;
	/** The connection went, by hang-up, missed heartbeats or a bad frame; channels stay. */
	lost: { reason: string };
	/** Acks brought unacked bytes back under the bound: writers may go on. */
	drain: undefined;
	/** The other end acked something; `acked()` waits on it. */
	acked: undefined;
}

/** How a `WorkerSession` paces and bounds itself. */
export interface WorkerSessionOptions {
	/**
	 * What its hello or welcome names it by: the id a coordinator started
	 * again answers as, so its worker finds it unchanged and keeps every
	 * channel; new by default.
	 */
	id?: string;
	capabilities?: string[];
	/** Unacked bytes kept for replay before writes return `false`. */
	bufferBytes?: number;
	/** How often each end pings the other. */
	heartbeat?: Duration;
	/** How long without a frame before the other end counts as gone. */
	timeout?: Duration;
	/** How long acks gather before they go, so a burst costs one ack. */
	ackDelay?: Duration;
	/**
	 * `delivery` acks data and messages once listeners have them; `manual`
	 * waits for `WorkerChannel.ack`, for an end that must first write them
	 * down. Opens and closes are acked on arrival either way.
	 */
	acks?: "delivery" | "manual";
	timer?: Timer;
	clock?: Clock;
	/** Stamps `lastHeard`. */
	wall?: WallClock;
}

/**
 * One end of the link between a coordinator and a worker, the same code on
 * both. It outlives any one connection: channels stay open across a
 * reconnect, every channel frame is kept until the other end acks it, and a
 * new connection replays what was not acked, in order, once.
 */
export class WorkerSession implements Eventful<WorkerSessionEvents>, Resource {
	/** What its hello or welcome names it by, so the other end can tell one started again. */
	readonly id: string;
	private readonly dispatcher = new Dispatcher<WorkerSessionEvents>();
	readonly events = this.dispatcher.events;
	private readonly channels = new Map<number, WorkerChannel>();
	private readonly replay: WorkerReplay;
	private readonly sent = new Map<number, number>();
	private readonly received = new Map<number, number>();
	/** Channels taken back without knowing where the other end's replay starts: its first frame says. */
	private readonly unplaced = new Set<number>();
	/** Channels taken back from the session this one resumes, until the first handshake says the other end holds them. */
	private readonly taken = new Set<number>();
	/**
	 * What was sent on a taken channel before that handshake, which says
	 * where its seqs carry on from: numbered and sent then.
	 */
	private readonly deferred = new Map<number, Unnumbered[]>();
	private readonly held = new Map<number, number>();
	private readonly pendingAcks = new Map<number, number>();
	/** Channels both ends closed, kept until a pong proves the other end has their ack. */
	private readonly forgetting = new Map<number, number | undefined>();
	private readonly capabilities: string[];
	private readonly heartbeat: Duration;
	private readonly timeout: Duration;
	private readonly ackDelay: Duration;
	private readonly acks: "delivery" | "manual";
	private readonly timer: Timer;
	private readonly clock: Clock;
	private readonly wall: WallClock;
	private readonly link: WorkerChannelLink;
	private connection: WorkerConnection | undefined;
	private nextChannel: number;
	private nextPing = 0;
	private wasFull = false;
	private _negotiated: Negotiated | undefined;
	private _lastHeard: number | null = null;
	private disposed = false;
	/** Hung up for a restart: its channels live on at the other end, for the next session to take back. */
	private detached = false;
	/** Made with an id, so the other end may hold channels of the session it resumes. */
	private readonly resumed: boolean;
	/** The other end's session at the last handshake; null before the first. */
	private peer: string | null = null;

	constructor(
		readonly role: "worker" | "coordinator",
		opts: WorkerSessionOptions = {},
	) {
		this.id = opts.id ?? crypto.randomUUID();
		this.resumed = opts.id !== undefined;
		this.capabilities = opts.capabilities ?? [];
		this.replay = new WorkerReplay(opts.bufferBytes ?? 8 * 1024 * 1024);
		this.heartbeat = opts.heartbeat ?? Duration.secs(10);
		this.timeout = opts.timeout ?? Duration.secs(30);
		this.ackDelay = opts.ackDelay ?? Duration.ms(20);
		this.acks = opts.acks ?? "delivery";
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemClock();
		this.wall = opts.wall ?? new SystemWallClock();
		// Each end numbers the channels it opens apart, so neither waits on the other for an id.
		this.nextChannel = role === "worker" ? 1 : 2;
		this.link = {
			send: (channel, frame) =>
				this.taken.has(channel)
					? this.defer({ ...frame, channel })
					: this.sendOnChannel({
							...frame,
							channel,
							seq: this.nextSeq(channel),
						}),
			ack: (channel, seq) => this.ack(channel, seq),
			done: (channel) => this.channelDone(channel),
		};
	}

	/**
	 * Reads the first frame of a new connection, which must be a worker's
	 * hello, so the coordinator can pick the session it resumes.
	 */
	static hello(socket: WorkerSocket): Promise<WorkerHello> {
		return new Promise((resolve, reject) => {
			const listening = new Disposer();
			listening.defer(
				socket.events.on("frame", (encoded) => {
					listening.dispose();
					try {
						const frame = WorkerProtocol.decode(encoded);
						if (frame.type !== "hello") {
							throw new Error(`a worker opens with hello, not ${frame.type}`);
						}
						resolve(frame);
					} catch (error) {
						socket.dispose();
						reject(error);
					}
				}),
			);
			listening.defer(
				socket.events.on("close", () => {
					listening.dispose();
					reject(new Error("the worker hung up before its hello"));
				}),
			);
		});
	}

	/** What the last handshake settled on, once there has been one. */
	get negotiated(): Negotiated | undefined {
		return this._negotiated;
	}

	/** When any frame last came from the other end, in epoch milliseconds; null before the first. */
	get lastHeard(): number | null {
		return this._lastHeard;
	}

	get connected(): boolean {
		return this.connection?.live ?? false;
	}

	/** False while unacked bytes are at the bound; `drain` says when that ends. */
	get writable(): boolean {
		return !this.replay.full;
	}

	/** Settles once writes may go on: at once, or at the next `drain`. */
	drained(): Promise<void> {
		if (this.writable) {
			return Promise.resolve();
		}
		return new Promise((resolve) =>
			this.events.on("drain", () => resolve(), { once: true }),
		);
	}

	/** Opens a channel to the other end, which hears it as `channel`. */
	open(kind: string, params: Json = null): WorkerChannel {
		this.assertOpen();
		const id = this.nextChannel;
		this.nextChannel += 2;
		const channel = new WorkerChannel(id, kind, params, this.link);
		this.channels.set(id, channel);
		this.sendOnChannel({
			type: "open",
			channel: id,
			seq: this.nextSeq(id),
			kind,
			params,
		});
		return channel;
	}

	/**
	 * Takes back channel `id`, which the other end still holds from the
	 * session this one resumes, before the handshake: `held` is the last seq
	 * of the other end's this end has, which its replay then follows, or null
	 * to take the replay from wherever it starts. What this end sends on it
	 * carries on from what the other end's hello says it received.
	 */
	resume(
		id: number,
		kind: string,
		params: Json,
		held: number | null,
	): WorkerChannel {
		this.assertOpen();
		if (this.channels.has(id)) {
			throw new Error(`channel ${id} is open already`);
		}
		const channel = new WorkerChannel(id, kind, params, this.link);
		this.channels.set(id, channel);
		this.taken.add(id);
		if (held === null) {
			this.unplaced.add(id);
		} else {
			this.received.set(id, held);
			this.held.set(id, held);
		}
		return channel;
	}

	/**
	 * The worker's side of a handshake: says hello on `socket`, and on welcome
	 * replays what the coordinator does not hold. Resolves with what was
	 * negotiated, or why not: refused for another major, or the link went.
	 */
	connect(
		socket: WorkerSocket,
		hello: { id: string; info?: { [key: string]: Json } },
	): Promise<Negotiated> {
		this.assertRole("worker");
		const connection = this.attach(socket);
		this.write(socket, {
			type: "hello",
			protocol: WorkerProtocol.version,
			capabilities: this.capabilities,
			id: hello.id,
			info: hello.info ?? {},
			session: this.id,
			held: [...this.held],
		});
		return connection.settled.promise;
	}

	/**
	 * The coordinator's side of a handshake, given the hello
	 * `WorkerSession.hello` read: welcomes the worker and replays what it
	 * does not hold, or refuses one on another major, hanging up, so the
	 * coordinator can drain it with the reason.
	 */
	accept(socket: WorkerSocket, hello: WorkerHello): Negotiated {
		this.assertRole("coordinator");
		const negotiated = WorkerProtocol.negotiate(
			{ protocol: WorkerProtocol.version, capabilities: this.capabilities },
			hello,
		);
		if (!negotiated.ok) {
			const reason = `the worker ${negotiated.reason}`;
			this.write(socket, { type: "refuse", reason });
			socket.dispose();
			return { ok: false, reason, refused: true };
		}
		const connection = this.attach(socket);
		if (this.resumed && this.peer === null) {
			this.takeBack(hello.held);
		}
		this.write(socket, {
			type: "welcome",
			protocol: WorkerProtocol.version,
			capabilities: this.capabilities,
			session: this.id,
			held: [...this.held],
		});
		this.go(connection, negotiated, hello.held, hello.session);
		return negotiated;
	}

	/**
	 * What the worker's hello says it holds of the channels of the session
	 * this one resumes, at its first handshake: this end sends on each from
	 * past that, opens new ones past them all, and closes those nobody took
	 * back, which ends what they ran. One taken back that the worker does
	 * not hold, as after the worker too started again, ends here.
	 */
	private takeBack(held: Held): void {
		const holds = new Set(held.map(([channel]) => channel));
		for (const id of this.taken) {
			const channel = this.channels.get(id);
			if (channel !== undefined && !holds.has(id)) {
				for (const state of [this.channels, this.received, this.held]) {
					state.delete(id);
				}
				this.unplaced.delete(id);
				channel.drop();
			}
		}
		this.taken.clear();
		// What was deferred on one the worker dropped goes with it.
		const deferred = new Map(this.deferred);
		this.deferred.clear();
		for (const [channel, seq] of held) {
			if (seq > (this.sent.get(channel) ?? 0)) {
				this.sent.set(channel, seq);
			}
			for (const frame of deferred.get(channel) ?? []) {
				this.sendOnChannel({ ...frame, seq: this.nextSeq(channel) });
			}
			if (channel % 2 === this.nextChannel % 2 && channel >= this.nextChannel) {
				this.nextChannel = channel + 2;
			}
			if (!this.channels.has(channel)) {
				const unclaimed = new WorkerChannel(
					channel,
					"unclaimed",
					null,
					this.link,
				);
				this.channels.set(channel, unclaimed);
				this.unplaced.add(channel);
				unclaimed.dispose();
			}
		}
	}

	/**
	 * Hangs up for a restart, keeping every channel open at the other end:
	 * a session with this id takes them back once it comes up.
	 */
	detach(): void {
		this.detached = true;
		this.lose("the coordinator is restarting");
	}

	/** Settles once the other end has acked everything sent, or at once with nothing out. */
	acked(): Promise<void> {
		if (this.replay.bytes === 0) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			const off = this.events.on("acked", () => {
				if (this.replay.bytes === 0) {
					off();
					resolve();
				}
			});
		});
	}

	/** Hangs up and closes every channel; the other end hears them close. */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		if (!this.detached) {
			for (const channel of [...this.channels.values()]) {
				channel.dispose();
			}
		}
		this.flushAcks();
		this.disposed = true;
		this.lose("the session ended");
		this.dispatcher.dispose();
	}

	private attach(socket: WorkerSocket): WorkerConnection {
		this.assertOpen();
		this.lose("a new connection replaced it");
		const connection = new WorkerConnection(socket, this.clock.now());
		this.connection = connection;
		this._lastHeard = this.wall.now();
		connection.resources.defer(
			socket.events.on("frame", (encoded) => this.hear(encoded)),
		);
		connection.resources.defer(
			socket.events.on("close", () => this.lose("the connection closed")),
		);
		connection.resources.use(
			this.timer.setInterval(() => this.beat(), this.heartbeat),
		);
		return connection;
	}

	private go(
		connection: WorkerConnection,
		negotiated: Negotiated,
		held: Held,
		peer: string,
	): void {
		if (this.peer !== null && this.peer !== peer) {
			this.forget();
		}
		this.peer = peer;
		this._negotiated = negotiated;
		connection.live = true;
		// The handshake told the other end everything this one holds.
		this.pendingAcks.clear();
		this.acknowledged(held);
		for (const encoded of this.replay.unacked()) {
			connection.socket.send(encoded);
		}
		// So a pong after the handshake proves the other end has heard what it held.
		for (const [channel, ping] of this.forgetting) {
			if (ping === undefined) {
				this.forgetting.set(channel, this.nextPing);
			}
		}
		this.dispatcher.dispatch("connected");
		connection.settled.resolve(negotiated);
	}

	private hear(encoded: string | Uint8Array): void {
		const connection = this.connection;
		if (!connection) {
			return;
		}
		connection.heard = this.clock.now();
		this._lastHeard = this.wall.now();
		let frame: Frame;
		try {
			frame = WorkerProtocol.decode(encoded);
		} catch (error) {
			this.lose(`a frame could not be read: ${(error as Error).message}`);
			return;
		}
		if (!connection.live) {
			this.handshake(connection, frame);
			return;
		}
		switch (frame.type) {
			case "ack":
				this.acknowledged(frame.acks);
				return;
			case "ping":
				this.write(connection.socket, { type: "pong", n: frame.n });
				return;
			case "pong":
				this.ponged(frame.n);
				return;
			case "open":
			case "message":
			case "data":
			case "close":
				this.receive(frame);
				return;
			default:
				this.lose(`${frame.type} came after the handshake`);
		}
	}

	private handshake(connection: WorkerConnection, frame: Frame): void {
		if (this.role === "coordinator") {
			this.lose(`${frame.type} came before the handshake`);
			return;
		}
		if (frame.type === "refuse") {
			connection.settled.resolve({
				ok: false,
				reason: frame.reason,
				refused: true,
			});
			this.lose(`refused: ${frame.reason}`);
			return;
		}
		if (frame.type !== "welcome") {
			this.lose(`${frame.type} came before the welcome`);
			return;
		}
		const negotiated = WorkerProtocol.negotiate(
			{ protocol: WorkerProtocol.version, capabilities: this.capabilities },
			frame,
		);
		if (!negotiated.ok) {
			const reason = `the coordinator ${negotiated.reason}`;
			connection.settled.resolve({ ok: false, reason, refused: true });
			this.lose(reason);
			return;
		}
		this.go(connection, negotiated, frame.held, frame.session);
	}

	private receive(frame: ChannelFrame): void {
		// Taken back blind: the other end's replay starts where it starts.
		if (this.unplaced.delete(frame.channel)) {
			this.received.set(frame.channel, frame.seq - 1);
		}
		const last = this.received.get(frame.channel) ?? 0;
		if (frame.seq <= last) {
			return;
		}
		if (frame.seq !== last + 1) {
			this.lose(
				`channel ${frame.channel} skipped from seq ${last} to ${frame.seq}`,
			);
			return;
		}
		this.received.set(frame.channel, frame.seq);
		if (frame.type === "open") {
			if (frame.seq !== 1 || this.channels.has(frame.channel)) {
				this.lose(`channel ${frame.channel} opened twice`);
				return;
			}
			const channel = new WorkerChannel(
				frame.channel,
				frame.kind,
				frame.params,
				this.link,
			);
			this.channels.set(frame.channel, channel);
			this.ack(frame.channel, frame.seq);
			this.dispatcher.dispatch("channel", channel);
			return;
		}
		const channel = this.channels.get(frame.channel);
		if (!channel) {
			// A close for a channel closed here already, as a session started
			// again sends for one it found closed, is nothing to do.
			if (frame.type === "close") {
				this.ack(frame.channel, frame.seq);
				return;
			}
			this.lose(`${frame.type} on channel ${frame.channel}, which is not open`);
			return;
		}
		const heard = channel.receive(frame);
		if (!heard || this.acks === "delivery") {
			this.ack(frame.channel, frame.seq);
		}
	}

	/** Holds `frame` for the handshake that says what seq it goes out as. */
	private defer(frame: Unnumbered): boolean {
		const kept = this.deferred.get(frame.channel) ?? [];
		kept.push(frame);
		this.deferred.set(frame.channel, kept);
		return !this.replay.full;
	}

	private sendOnChannel(frame: ChannelFrame): boolean {
		const encoded = WorkerProtocol.encode(frame);
		const room = this.replay.keep(frame, encoded);
		this.wasFull ||= !room;
		if (this.connection?.live) {
			this.connection.socket.send(encoded);
		}
		return room;
	}

	private nextSeq(channel: number): number {
		const seq = (this.sent.get(channel) ?? 0) + 1;
		this.sent.set(channel, seq);
		return seq;
	}

	private ack(channel: number, seq: number): void {
		if (seq <= (this.held.get(channel) ?? 0)) {
			return;
		}
		this.held.set(channel, seq);
		this.pendingAcks.set(channel, seq);
		const connection = this.connection;
		if (connection?.live && !connection.ackFlush) {
			connection.ackFlush = this.timer.setTimeout(
				() => this.flushAcks(),
				this.ackDelay,
			);
		}
	}

	private flushAcks(): void {
		const connection = this.connection;
		connection?.ackFlush?.dispose();
		if (connection) {
			connection.ackFlush = undefined;
		}
		if (!connection?.live || this.pendingAcks.size === 0) {
			return;
		}
		this.write(connection.socket, {
			type: "ack",
			acks: [...this.pendingAcks],
		});
		this.pendingAcks.clear();
		for (const [channel, ping] of this.forgetting) {
			if (ping === undefined) {
				this.forgetting.set(channel, this.nextPing);
			}
		}
	}

	private acknowledged(acks: Held): void {
		this.replay.ack(acks);
		this.dispatcher.dispatch("acked");
		if (this.wasFull && !this.replay.full) {
			this.wasFull = false;
			this.dispatcher.dispatch("drain");
		}
	}

	/**
	 * Ends every channel at this end, for another end started again, which
	 * knows none of them: what they ran stops, as when the old one hung up.
	 */
	private forget(): void {
		const channels = [...this.channels.values()];
		for (const state of [
			this.channels,
			this.sent,
			this.received,
			this.unplaced,
			this.taken,
			this.deferred,
			this.held,
			this.pendingAcks,
			this.forgetting,
		]) {
			state.clear();
		}
		this.replay.clear();
		this.acknowledged([]);
		for (const channel of channels) {
			channel.drop();
		}
	}

	private channelDone(channel: number): void {
		this.channels.delete(channel);
		this.sent.delete(channel);
		// Closed at both ends, nothing will take it back, so what the other
		// end never acked, as a coordinator acking by hand does for a process
		// it only listed, goes with it.
		this.replay.drop(channel);
		this.acknowledged([]);
		// Its close is acked once the ack has gone out; a pong after that proves it arrived.
		this.forgetting.set(channel, undefined);
	}

	private ponged(answered: number): void {
		for (const [channel, ping] of this.forgetting) {
			if (ping !== undefined && ping <= answered) {
				this.forgetting.delete(channel);
				this.received.delete(channel);
				this.held.delete(channel);
			}
		}
	}

	private beat(): void {
		const connection = this.connection;
		if (!connection) {
			return;
		}
		const quiet = this.clock.now().subtract(connection.heard);
		if (quiet.isGreaterThan(this.timeout)) {
			this.lose(`nothing heard for ${quiet.secs}s`);
			return;
		}
		if (connection.live) {
			this.flushAcks();
			this.write(connection.socket, { type: "ping", n: this.nextPing++ });
		}
	}

	private write(socket: WorkerSocket, frame: Frame): void {
		socket.send(WorkerProtocol.encode(frame));
	}

	private lose(reason: string): void {
		const connection = this.connection;
		if (!connection) {
			return;
		}
		this.connection = undefined;
		connection.dispose();
		connection.settled.resolve({ ok: false, reason, refused: false });
		for (const [channel, ping] of this.forgetting) {
			if (ping !== undefined) {
				this.forgetting.set(channel, undefined);
			}
		}
		this.dispatcher.dispatch("lost", { reason });
	}

	private assertRole(role: "worker" | "coordinator"): void {
		if (this.role !== role) {
			throw new Error(`only a ${role} session can do that`);
		}
	}

	private assertOpen(): void {
		if (this.disposed || this.detached) {
			throw new Error("the session is disposed");
		}
	}
}

/** A channel frame before the session numbers it. */
type Unnumbered = {
	[K in ChannelFrame["type"]]: Omit<Extract<ChannelFrame, { type: K }>, "seq">;
}[ChannelFrame["type"]];
