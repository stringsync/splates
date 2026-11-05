import { useAuiState } from "@assistant-ui/react";
import { useEffect, useRef } from "react";
import { loopLimits } from "./eval-loops";
import type { EvalRun } from "./eval-run";

/**
 * Prefills the limits from the opening eval directive once the card is ready.
 * A budget limits spending; each round still waits for the person to press Run.
 */
export function useLoopLimits(
	run: EvalRun,
	{ ready }: { ready: boolean },
): void {
	const opening = useAuiState((state) =>
		state.thread.messages
			.find((each) => each.role === "user")
			?.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n"),
	);
	const limits = opening === undefined ? null : loopLimits(opening);
	const started = useRef(false);
	useEffect(() => {
		if (limits === null || started.current || !ready) {
			return;
		}
		started.current = true;
		run.setLimits(limits);
	}, [limits, ready, run]);
}
