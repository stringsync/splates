import { raiseIn, type SignalHome } from "./routes";

/** The signal an agent can read the week's kills from: raised on every kill a page reports. */
export const PAGE_KILLED = "splates.page-killed";
/** The signal an agent waits on to investigate kills: raised once they have repeated. */
export const PAGE_KILLS_REPEATED = "splates.page-kills-repeated";
/** How many kills in a week make a batch: the signal is raised on every multiple of it. */
export const REPEATED_AFTER = 3;

/** What a page reports when it reloaded after the system killed it. */
export interface PageKill {
	/** The conversation open when the page last ran, or null for none. */
	conversation: string | null;
	/** How many messages that conversation held. */
	messages: number | null;
	/** The device's own words for itself, as `navigator.userAgent`. */
	agent: string;
}

/** Reads a report from a request body, or null when it is not one. */
export function pageKillOf(input: Record<string, unknown>): PageKill | null {
	if (typeof input.agent !== "string") {
		return null;
	}
	return {
		conversation:
			typeof input.conversation === "string" ? input.conversation : null,
		messages: typeof input.messages === "number" ? input.messages : null,
		agent: input.agent.slice(0, 300),
	};
}

/**
 * Takes a page's report that the system killed it. Every third kill of the
 * week raises the signal an agent waits on, carrying the week's kills, so an
 * automation on it runs once per batch.
 */
export async function reportPageKill(
	home: Pick<SignalHome, "book" | "all" | "fire">,
	kill: PageKill,
): Promise<{ kills: number }> {
	await raiseIn(home, PAGE_KILLED, "web", kill);
	const week = (await home.book.raises())[PAGE_KILLED] ?? [];
	if (week.length % REPEATED_AFTER === 0) {
		await raiseIn(home, PAGE_KILLS_REPEATED, "web", {
			kills: week.length,
			recent: week.map((one) => ({ at: one.at, ...(one.payload as object) })),
		});
	}
	return { kills: week.length };
}

/** The route a page reports its kills to: reads the request, and answers with the week's count. */
export function pageKillRoute(
	home: Pick<SignalHome, "book" | "all" | "fire">,
	read: (request: Request) => Promise<Record<string, unknown>>,
): (request: Request) => Promise<Response> {
	return async (request) => {
		const kill = pageKillOf(await read(request));
		if (kill === null) {
			return Response.json({ error: "no agent" }, { status: 400 });
		}
		return Response.json(await reportPageKill(home, kill));
	};
}
