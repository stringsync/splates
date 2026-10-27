import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { Disposer, disposables, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import { scoped } from "./api";
import { tabId } from "./tab";

/** How long after its socket goes short of an exit a session tries the shell again. */
export const RECONNECT = Duration.secs(2);

export type TerminalSessionEvents = { changed: undefined };

/**
 * The keys a phone's keyboard lacks, which the page offers in a bar under
 * its terminal: what each sends, an arrow as the shell's cursor mode wants.
 */
export type TerminalKey =
	| "escape"
	| "tab"
	| "enter"
	| "ctrl-c"
	| "ctrl-d"
	| "up"
	| "down"
	| "left"
	| "right";

const ARROWS = { up: "A", down: "B", right: "C", left: "D" } as const;

const SENDS = {
	escape: "\x1b",
	tab: "\t",
	enter: "\r",
	"ctrl-c": "\x03",
	"ctrl-d": "\x04",
} as const;

/** Where a session's shell stands, as the page shows it. */
export type TerminalStatus = "connecting" | "open" | "exited" | "closed";

/**
 * One of the server's shells in the page: mount it with `attach` wherever it
 * should show, type into it with `run` and `press`, and `dispose` it to end
 * the shell. It keeps its screen while unmounted, and comes back to the same
 * shell after a reload or a server restart.
 */
export class TerminalSession
	implements Eventful<TerminalSessionEvents>, Resource
{
	// Drawn by xterm.js over a WebSocket. The server keeps the shell by this
	// tab and `key`, so a socket that goes short of the shell's exit is tried
	// again, and the server redraws the screen.
	private readonly dispatcher = new Dispatcher<TerminalSessionEvents>();
	readonly events = this.dispatcher.events;

	status: TerminalStatus = "connecting";
	/** Whether the next letter typed goes as Control and that letter, as a phone's Ctrl key sets. */
	control = false;
	/** What the page draws the terminal into; mount it with `attach`. */
	readonly element = document.createElement("div");

	private readonly terminal: Terminal;
	private readonly fit = new FitAddon();
	private readonly disposer = new Disposer();
	private socket: WebSocket | null = null;
	/** Each `front` waiting on the shell's answer, oldest first. */
	private asking: ((command: string | null) => void)[] = [];
	private readonly timer: Timer;
	/** The slug of the project its tree is in; the page's for null. */
	private readonly project: string | null;
	/** The try to come, once the socket went short of an exit. */
	private retrying: Resource | null = null;
	private disposed = false;
	/** Explicit runs waiting for the socket to open, removed before sending. */
	private pending: string[] = [];

	/**
	 * A shell in `task`'s worktree, or the main tree for null, kept by the
	 * server under `key` for this tab, which leaves to the page each key
	 * `toggles` says shows or hides it.
	 */
	constructor(
		readonly key: string,
		readonly task: string | null,
		// scry-ignore objects-over-callbacks: a test of one key, read as each key comes
		toggles: (event: KeyboardEvent) => boolean,
		{
			timer = new SystemTimer(),
			project = null,
		}: {
			timer?: Timer;
			/** The slug of the project `task` is in; the page's for null. */
			project?: string | null;
		} = {},
	) {
		this.project = project;
		this.timer = timer;
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
			this.terminal.onData((data) =>
				this.send(encoder.encode(this.controlled(data))),
			),
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

	/** Pastes a code block and presses Enter, once connected if still opening. */
	run(code: string): void {
		if (this.disposed || this.status === "exited" || !code.trim()) {
			return;
		}
		if (this.socket?.readyState !== WebSocket.OPEN) {
			this.pending.push(code);
			return;
		}
		this.terminal.paste(code.replace(/\r?\n$/, ""));
		this.terminal.input("\r", true);
		this.focus();
	}

	/** Types `key` into the shell, as though pressed on a keyboard that has it. */
	press(key: TerminalKey): void {
		this.setControl(false);
		const data =
			key in ARROWS
				? `${this.terminal.modes.applicationCursorKeysMode ? "\x1bO" : "\x1b["}${ARROWS[key as keyof typeof ARROWS]}`
				: SENDS[key as keyof typeof SENDS];
		this.terminal.input(data, true);
	}

	/** Holds Control for the next letter typed, or lets it go. */
	setControl(control: boolean): void {
		if (this.control !== control) {
			this.control = control;
			this.dispatcher.dispatch("changed");
		}
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

	/** Hangs up for good: the server ends the shell now rather than waiting for this tab. */
	dispose(): void {
		this.disposed = true;
		this.pending = [];
		this.retrying?.dispose();
		this.retrying = null;
		this.answered(null);
		this.send(JSON.stringify({ type: "close" }));
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
		this.retrying = null;
		const query = new URLSearchParams({
			cols: String(this.terminal.cols),
			rows: String(this.terminal.rows),
			terminal: `${tabId()}/${this.key}`,
		});
		if (this.task !== null) {
			query.set("task", this.task);
		}
		const scheme = location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(
			`${scheme}//${location.host}${scoped(`/api/terminal?${query}`, this.project)}`,
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
			for (const code of this.pending.splice(0)) {
				this.run(code);
			}
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
			if (this.status === "exited" || this.disposed || this.socket !== socket) {
				return;
			}
			this.set("closed");
			// The server, or the shell it kept, may be back in a moment: the
			// screen is cleared first, since the server redraws it.
			this.retrying = this.timer.setTimeout(() => {
				this.terminal.reset();
				this.connect();
			}, RECONNECT);
		};
		this.socket = socket;
	}

	/**
	 * `data` as typed, or, while Control is held, the next letter as its
	 * control character, as Control and C makes ^C; Control lets go on any key.
	 */
	private controlled(data: string): string {
		if (!this.control) {
			return data;
		}
		this.setControl(false);
		const code = data.length === 1 ? data.toUpperCase().charCodeAt(0) : -1;
		return code >= 0x40 && code <= 0x5f
			? String.fromCharCode(code & 0x1f)
			: data;
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
