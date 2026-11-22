import { useAuiState } from "@assistant-ui/react";
import { type WaitRequest, waitIn, waitOutcome } from "#web/wait-request.ts";

/**
 * The wait an agent's reply ends by asking for, with the reply's text before
 * it, when it asked and how it ended; null when the reply asks for none or
 * `agent` is false.
 */
export function useWaitTail(
	text: string,
	agent: boolean,
): {
	body: string;
	directive: string;
	wait: WaitRequest;
	at: string | null;
	outcome: string | null;
} | null {
	const at = useAuiState((s) => {
		const stamp = s.message.metadata.custom.at;
		return typeof stamp === "string" ? stamp : null;
	});
	const reply = useAuiState((s) => {
		const all = s.thread.messages;
		const next = all[all.findIndex((each) => each.id === s.message.id) + 1];
		const first = next?.content[0];
		return next?.role === "user" && first?.type === "text"
			? first.text
			: undefined;
	});
	const found = agent ? waitIn(text) : null;
	return found === null ? null : { ...found, at, outcome: waitOutcome(reply) };
}
