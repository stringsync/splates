import type { Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";
import { answered, scoped } from "./api/request";
import { LiveStream } from "./live-stream";

/** A terminal the server keeps for this project, which every page shows. */
export interface SharedTerminal {
	key: string;
	/** What a page named it, or null for the name it goes by. */
	name: string | null;
}

export type SharedTerminalsEvents = { changed: undefined };

/**
 * The terminals the server holds for the project this page shows, as every
 * device sees them: `list` is what is up now, kept current as any page opens,
 * names or closes one.
 */
export class SharedTerminals
	implements Eventful<SharedTerminalsEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<SharedTerminalsEvents>();
	readonly events = this.dispatcher.events;

	/** The terminals up, as the server last said; empty until it has. */
	list: SharedTerminal[] = [];

	/** Whether the server has said yet, so an empty `list` means none are up. */
	loaded = false;

	private stream: LiveStream | null = null;
	private disposed = false;

	constructor(private readonly project: string | null = null) {}

	/** Reads the list and keeps it current. */
	start(): void {
		// Safe to call again, and after `dispose`: a mount effect runs twice in development.
		if (this.stream !== null) {
			return;
		}
		this.disposed = false;
		this.stream = new LiveStream(
			scoped("/api/terminals/events", this.project),
			{
				message: () => {},
				named: {
					terminals: (event) => {
						const said = JSON.parse(event.data) as { project: string };
						if (said.project === this.slug()) {
							void this.load();
						}
					},
				},
				// On every open, and so again after the stream dropped, what moved
				// while it was away was never said.
				open: () => void this.load(),
			},
		);
	}

	/** The name of terminal `key` if the server has one, else undefined. */
	find(key: string): SharedTerminal | undefined {
		return this.list.find((each) => each.key === key);
	}

	/** Names terminal `key` for every page; a blank name goes back to its default. */
	async rename(key: string, name: string): Promise<void> {
		try {
			await answered(scoped("/api/terminals/name", this.project), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ key, name }),
			});
		} catch {
			// The name holds on this page; the server's says otherwise on the next read.
		}
	}

	private async load(): Promise<void> {
		try {
			const response = await answered(scoped("/api/terminals", this.project));
			if (!response.ok || this.disposed) {
				return;
			}
			const read = (await response.json()) as { terminals: SharedTerminal[] };
			this.said(read.terminals);
		} catch {
			// Offline or the server gone: the stream says when it is back.
		}
	}

	/** Takes in the terminals the server says are up. */
	said(terminals: SharedTerminal[]): void {
		this.list = terminals;
		this.loaded = true;
		this.dispatcher.dispatch("changed");
	}

	/** The slug the server names this page's project by: empty for the one it started in. */
	private slug(): string {
		return (
			this.project ??
			new URLSearchParams(globalThis.location?.search).get("project") ??
			""
		);
	}

	dispose(): void {
		this.disposed = true;
		this.stream?.dispose();
		this.stream = null;
	}
}
