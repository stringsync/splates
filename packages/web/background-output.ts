import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Disposer, disposables, type Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { scoped } from "./api";

export type BackgroundOutputEvents = { changed: undefined };

/** Where reading a command's output stands, as the pane shows it. */
export type BackgroundOutputStatus = "connecting" | "open" | "ended" | "closed";

/**
 * What a background command printed, read from the server as it prints it
 * and drawn by xterm.js, which takes no keys: only the agent writes to it.
 */
export class BackgroundOutput
	implements Eventful<BackgroundOutputEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<BackgroundOutputEvents>();
	readonly events = this.dispatcher.events;

	status: BackgroundOutputStatus = "connecting";
	/** What the page draws the terminal into; mount it with `attach`. */
	readonly element = document.createElement("div");

	private readonly terminal = new Terminal({
		disableStdin: true,
		cursorStyle: "underline",
		cursorInactiveStyle: "none",
		// A file of output has bare new lines, which a terminal would leave
		// at the column they ended on.
		convertEol: true,
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		fontSize: 13,
		theme: { background: "#0a0a0a" },
	});
	private readonly fit = new FitAddon();
	private readonly disposer = new Disposer();
	private readonly reading = new AbortController();

	/**
	 * Background command `background` of conversation `conversation`, led by
	 * `command` after a `$` as a shell would echo it, where it has one.
	 */
	constructor(
		readonly conversation: string,
		readonly background: string,
		readonly command: string | null = null,
	) {
		this.element.className = "h-full w-full";
		this.terminal.loadAddon(this.fit);
		this.disposer.use(this.terminal);
	}

	/**
	 * Draws the output in `container`, sized to it and following its size,
	 * and starts reading the first time. Disposing the result takes it out.
	 */
	attach(container: HTMLElement): Resource {
		container.append(this.element);
		if (this.terminal.element === undefined) {
			this.terminal.open(this.element);
			this.fitted();
			if (this.command !== null) {
				this.terminal.write(`$ ${this.command}\n`);
			}
			void this.read();
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

	dispose(): void {
		this.reading.abort();
		this.disposer.dispose();
		this.element.remove();
		this.dispatcher.dispose();
	}

	private fitted(): void {
		if (this.element.isConnected) {
			this.fit.fit();
		}
	}

	private async read(): Promise<void> {
		try {
			const response = await fetch(
				scoped(
					`/api/conversations/${this.conversation}/background/${encodeURIComponent(this.background)}`,
				),
				{ signal: this.reading.signal },
			);
			if (!response.ok || response.body === null) {
				this.set("closed");
				return;
			}
			this.set("open");
			const reader = response.body.getReader();
			for (;;) {
				const { value, done } = await reader.read();
				if (done) {
					break;
				}
				this.terminal.write(value);
			}
			this.set("ended");
		} catch {
			if (!this.reading.signal.aborted) {
				this.set("closed");
			}
		}
	}

	private set(status: BackgroundOutputStatus): void {
		this.status = status;
		this.dispatcher.dispatch("changed");
	}
}
