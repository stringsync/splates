import type { Resource } from "core/disposable";

/** One event from Chrome, with the session it came from when it came from an attached target. */
export interface CdpEvent {
	method: string;
	params: Record<string, unknown>;
	sessionId?: string;
}

/** What a connection to Chrome's DevTools protocol can do: send a command and hear events. */
export interface Cdp extends Resource {
	send<T = Record<string, unknown>>(
		method: string,
		params?: Record<string, unknown>,
		sessionId?: string,
	): Promise<T>;
	on(listener: (event: CdpEvent) => void): Resource;
	/** Resolves when the connection closes, as it does when Chrome quits. */
	readonly closed: Promise<void>;
}

interface Reply {
	id: number;
	result?: Record<string, unknown>;
	error?: { message: string };
}

/**
 * The browser-wide DevTools socket, with targets attached in flat mode so one
 * socket carries every tab's commands, told apart by `sessionId`.
 */
export class CdpSocket implements Cdp {
	private next = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: Record<string, unknown>) => void;
			reject: (error: Error) => void;
		}
	>();
	private readonly listeners = new Set<(event: CdpEvent) => void>();
	readonly closed: Promise<void>;

	private constructor(private readonly socket: WebSocket) {
		socket.binaryType = "arraybuffer";
		socket.addEventListener("message", ({ data }) => {
			this.receive(JSON.parse(String(data)) as Reply & CdpEvent);
		});
		this.closed = new Promise((resolve) => {
			socket.addEventListener("close", () => {
				for (const { reject } of this.pending.values()) {
					reject(new Error("Chrome closed the DevTools connection"));
				}
				this.pending.clear();
				resolve();
			});
		});
	}

	static open(url: string): Promise<CdpSocket> {
		const socket = new WebSocket(url);
		return new Promise((resolve, reject) => {
			socket.addEventListener("open", () => resolve(new CdpSocket(socket)), {
				once: true,
			});
			socket.addEventListener(
				"error",
				() => reject(new Error(`could not reach Chrome at ${url}`)),
				{ once: true },
			);
		});
	}

	send<T = Record<string, unknown>>(
		method: string,
		params: Record<string, unknown> = {},
		sessionId?: string,
	): Promise<T> {
		const id = this.next++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
			});
			this.socket.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}

	on(listener: (event: CdpEvent) => void): Resource {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	dispose(): void {
		this.listeners.clear();
		this.socket.close();
	}

	private receive(message: Reply & CdpEvent): void {
		if (typeof message.id === "number") {
			const waiting = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) {
				waiting?.reject(new Error(message.error.message));
			} else {
				waiting?.resolve(message.result ?? {});
			}
			return;
		}
		for (const listener of this.listeners) {
			listener({
				method: message.method,
				params: message.params ?? {},
				sessionId: message.sessionId,
			});
		}
	}
}
