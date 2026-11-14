import { SEND_TIMEOUT } from "./sending";

/**
 * What a refused message's error says, in plain words for the line under it.
 * The raw error stays on hover.
 */
export function plainWhy(why: string): string {
	const raw = why.toLowerCase();
	if (raw.includes("timed out") || raw.includes("no answer in")) {
		return `the server didn't answer within ${SEND_TIMEOUT.ms / 1000}s.`;
	}
	if (raw.includes("lost the connection")) {
		return "the connection dropped before the server had it.";
	}
	if (
		raw.includes("no internet") ||
		raw.includes("failed to fetch") ||
		raw.includes("networkerror") ||
		raw.includes("load failed") ||
		raw.includes("network")
	) {
		return "the network is down or the server can't be reached.";
	}
	if (raw.includes("too big")) {
		return "it is too big to send.";
	}
	const said = why.trim().replace(/\.$/, "");
	return said === ""
		? "the server refused it."
		: `the server refused it: ${said}.`;
}
