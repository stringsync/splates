const KEY = "splates:page-state";

/** What the page last was, kept across loads so the next one can tell how it ended. */
interface PageState {
	/** In front, put away (hidden), or closed on purpose (ended). */
	state: "visible" | "hidden" | "ended";
	conversation: string | null;
	messages: number | null;
}

/** What the next load reports to the server: the page was in front and never closed. */
export interface Killed {
	conversation: string | null;
	messages: number | null;
	agent: string;
}

/**
 * Tells a reload after the system killed the page while it was in front, which
 * an installed iOS app shows as a white flash. Call `start` once per load: it
 * returns what the last load was showing when it died, or null when that load
 * ended any other way. Then `open` says which conversation is shown and
 * `become` how the page left the front.
 */
export class PageKill {
	private current: PageState = {
		state: "visible",
		conversation: null,
		messages: null,
	};

	constructor(
		private readonly storage: Pick<Storage, "getItem" | "setItem">,
		private readonly agent: string,
	) {}

	start(): Killed | null {
		const before = this.read();
		this.write();
		if (before === null || before.state !== "visible") {
			return null;
		}
		return {
			conversation: before.conversation,
			messages: before.messages,
			agent: this.agent,
		};
	}

	/** Says the conversation shown, and how many messages it holds; null for none. */
	open(conversation: string | null, messages: number | null): void {
		this.current = { ...this.current, conversation, messages };
		this.write();
	}

	/** Says the page went to the back, came forward or closed on purpose. */
	become(state: PageState["state"]): void {
		this.current = { ...this.current, state };
		this.write();
	}

	private read(): PageState | null {
		try {
			const text = this.storage.getItem(KEY);
			return text === null ? null : (JSON.parse(text) as PageState);
		} catch {
			return null;
		}
	}

	private write(): void {
		try {
			this.storage.setItem(KEY, JSON.stringify(this.current));
		} catch {
			// A full or blocked store only means no report.
		}
	}
}

/** The page's own `PageKill`: call `start` on load. With no local storage it never reports. */
export const livePage = new PageKill(
	typeof localStorage === "undefined"
		? { getItem: () => null, setItem: () => {} }
		: localStorage,
	typeof navigator === "undefined" ? "" : navigator.userAgent,
);
