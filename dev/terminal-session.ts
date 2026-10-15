import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { Disposer, disposables, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { scoped } from "./api";

export type TerminalSessionEvents = { changed: undefined };

/** Where a session's shell stands, as the page shows it. */
export type TerminalStatus = "connecting" | "open" | "exited" | "closed";

/**
 * One shell in the page: the server's, over a WebSocket, drawn by xterm.js
 * into an element of its own, which goes wherever the page mounts it and
 * keeps its screen while it is not mounted anywhere.
 */
export class TerminalSession
	implements Eventful<TerminalSessionEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<TerminalSessionEvents>();
	readonly events = this.dispatcher.events;

	status: TerminalStatus = "connecting";
	/** What the page draws the terminal into; mount it with `attach`. */
	readonly element = document.createElement("div");

	private readonly terminal: Terminal;
	private readonly fit = new FitAddon();
	private readonly disposer = new Disposer();
	private socket: WebSocket | null = null;
	/** Each `front` waiting on the shell's answer, oldest first. */
	private asking: ((command: string | null) => void)[] = [];

	/**
	 * A shell in `task`'s worktree, or the main tree for null, which leaves to
	 * the page each key `toggles` says shows or hides it.
	 */
	constructor(
		readonly task: string | null,
		// scry-ignore objects-over-callbacks: a test of one key, read as each key comes
		toggles: (event: KeyboardEvent) => boolean,
	) {
		this.element.className = "h-full w-full";
		this.terminal = new Terminal({
			cursorBlink: true,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			fontSize: 13,
			theme: { background: "#0a0a0a" },
		});
		this.terminal.loadAddon(this.fit);
		// Every key is the shell's, Escape and Tab included, for vim and
		// completion, but the toggle, which goes on up to the page's listener.
		this.terminal.attachCustomKeyEventHandler(
			(event) => event.type !== "keydown" || !toggles(event),
		);
		const encoder = new TextEncoder();
		// xterm's own disposables are `Resource`s already.
		this.disposer.use(this.terminal);
		this.disposer.use(
			this.terminal.onData((data) => this.send(encoder.encode(data))),
		);
		// Bytes xterm cannot put in a string unharmed, like some mouse reports.
		this.disposer.use(
			this.terminal.onBinary((data) =>
				this.send(Uint8Array.from(data, (char) => char.charCodeAt(0))),
			),
		);
		this.disposer.use(
			this.terminal.onResize(({ cols, rows }) =>
				this.send(JSON.stringify({ type: "resize", cols, rows })),
			),
		);
	}

	/**
	 * Draws the terminal in `container`, sized to it and following its size,
	 * and connects the first time. Disposing the result takes it out again,
	 * shell and screen left running.
	 */
	attach(container: HTMLElement): Resource {
		container.append(this.element);
		if (this.terminal.element === undefined) {
			this.terminal.open(this.element);
			this.draw();
			this.fitted();
			this.connect();
		} else {
			this.fitted();
		}
		const observer = new ResizeObserver(() => this.fitted());
		observer.observe(container);
		return disposables.callback(() => {
			observer.disconnect();
			this.element.remove();
		});
	}

	focus(): void {
		this.terminal.focus();
	}

	/**
	 * The job the shell runs in front, as `sleep 5`, or null at its prompt or
	 * with no shell to ask: what closing it would stop.
	 */
	front(): Promise<string | null> {
		if (this.socket?.readyState !== WebSocket.OPEN) {
			return Promise.resolve(null);
		}
		return new Promise((resolve) => {
			this.asking.push(resolve);
			this.send(JSON.stringify({ type: "front" }));
		});
	}

	dispose(): void {
		this.answered(null);
		this.socket?.close();
		this.socket = null;
		this.disposer.dispose();
		this.element.remove();
		this.dispatcher.dispose();
	}

	/** Fits the grid to the element, which only means something once it shows. */
	private fitted(): void {
		if (this.element.isConnected) {
			this.fit.fit();
		}
	}

	/**
	 * WebGL where the browser has it, which is most, and the DOM renderer
	 * where it does not or loses it.
	 */
	private draw(): void {
		try {
			const webgl = new WebglAddon();
			webgl.onContextLoss(() => webgl.dispose());
			this.terminal.loadAddon(webgl);
		} catch {
			// The DOM renderer xterm started with stays.
		}
	}

	private connect(): void {
		const query = new URLSearchParams({
			cols: String(this.terminal.cols),
			rows: String(this.terminal.rows),
		});
		if (this.task !== null) {
			query.set("task", this.task);
		}
		const scheme = location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(
			`${scheme}//${location.host}${scoped(`/api/terminal?${query}`)}`,
		);
		socket.binaryType = "arraybuffer";
		socket.onopen = () => {
			this.set("open");
			// The size may have settled since the address was made, while sends
			// had nowhere to go.
			this.send(
				JSON.stringify({
					type: "resize",
					cols: this.terminal.cols,
					rows: this.terminal.rows,
				}),
			);
		};
		socket.onmessage = ({ data }: MessageEvent) => {
			if (typeof data !== "string") {
				this.terminal.write(new Uint8Array(data as ArrayBuffer));
				return;
			}
			const control = JSON.parse(data) as {
				type: string;
				command?: string | null;
			};
			if (control.type === "exit") {
				this.set("exited");
			} else if (control.type === "front") {
				this.asking.shift()?.(control.command ?? null);
			}
		};
		socket.onclose = () => {
			this.answered(null);
			if (this.status !== "exited") {
				this.set("closed");
			}
		};
		this.socket = socket;
	}

	/** Answers every `front` still waiting with `command`. */
	private answered(command: string | null): void {
		for (const resolve of this.asking.splice(0)) {
			resolve(command);
		}
	}

	private send(data: string | Uint8Array<ArrayBuffer>): void {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(data);
		}
	}

	private set(status: TerminalStatus): void {
		this.status = status;
		this.dispatcher.dispatch("changed");
	}
}
