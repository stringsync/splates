import { useAuiState } from "@assistant-ui/react";
import { useEffect, useState } from "react";
import { loopLimits } from "./eval-loops";
import type { EvalRun } from "./eval-run";

/** Prefills the run's budget and round limits from the opening eval directive once `ready`. Each round still waits for Run. */
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
	const [prefill] = useState(() => new LimitsPrefill());
	useEffect(() => {
		prefill.apply(run, limits, ready);
	}, [prefill, limits, ready, run]);
}

type Limits = ReturnType<typeof loopLimits>;

/** Sets a run's limits once, the first time they are known and the run is ready. */
class LimitsPrefill {
	private started = false;

	apply(run: EvalRun, limits: Limits, ready: boolean): void {
		if (limits === null || this.started || !ready) {
			return;
		}
		this.started = true;
		run.setLimits(limits);
	}
}
