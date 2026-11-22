import { isProbeId, isSignalId } from "./signal-of";

/** The thread part a card placed by its id draws: a signal wait, a probe or a progress card. */
export function cardPart(id: string): {
	type: "data-signal" | "data-probe" | "data-progress";
	data: { id: string };
} {
	const type = isSignalId(id)
		? "data-signal"
		: isProbeId(id)
			? "data-probe"
			: "data-progress";
	return { type, data: { id } };
}
