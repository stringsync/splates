import { useAuiState } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";
import { loopLimits } from "./eval-loops";
import type { EvalRun } from "./eval-run";

/**
 * Runs the evals card for you when its conversation opened with an eval loop
 * directive: pass `ready` once the card can start. Choosing the loop's budget
 * and rounds is the permission, so no tap waits; the server still refuses a
 * card the budget cannot cover.
 */
export function useLoopAutostart(
	run: EvalRun,
	{ ready }: { ready: boolean },
): boolean {
	const opening = useAuiState((state) =>
		state.thread.messages
			.find((each) => each.role === "user")
			?.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n"),
	);
	const limits = opening === undefined ? null : loopLimits(opening);
	const started = useRef(false);
	const [automatic, setAutomatic] = useState(false);
	useEffect(() => {
		if (limits === null || started.current || !ready) {
			return;
		}
		started.current = true;
		setAutomatic(true);
		run.setLimits(limits);
		void run.run();
	}, [limits, ready, run]);
	return automatic;
}
