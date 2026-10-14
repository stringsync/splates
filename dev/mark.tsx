import { Loader2Icon } from "lucide-react";
import type { JSX } from "react";
import type { Ending } from "../asked";
import type { Need } from "../needs";
import { waitsOn } from "./conversation-names";
import { Dot } from "./dot";

/**
 * What a list shows of an agent: a yellow dot when it waits on you, whatever
 * for, a spinner while it works, assuming or not, a blue dot when it answered
 * and you have not looked since, and a green or red dot once its task merged
 * or was removed, over the blue one. Anything else, idle and read, shows an
 * empty space. A lane orchestrator done with its lanes shows green, as
 * a merge does, and one whose lanes wait on an escalated task yellow, as the
 * escalation does. A report in its last word decides the mark over a wait it
 * ended, though not over a live ask or a failure, which are newer. What it
 * waits on is in its tooltip. Each sits centered in a box of one size, so
 * marks line up down a list whichever kind they are.
 */
export function Mark({
	need,
	reported = null,
	unread = false,
}: {
	need: Need;
	reported?: Ending | null;
	unread?: boolean;
}): JSX.Element {
	const shows =
		need.kind === "idle" ||
		(need.kind === "waiting" && need.why !== "ask" && need.why !== "failed");
	if ((reported === "merged" || reported === "finished") && shows) {
		return <Dot role="img" aria-label={reported} color="bg-success" />;
	}
	if (reported === "removed" && shows) {
		return <Dot role="img" aria-label="removed" color="bg-destructive" />;
	}
	if (unread && need.kind === "idle" && !waitsOn(reported)) {
		return <Dot role="status" aria-label="unread" color="bg-info" />;
	}
	if (need.kind === "waiting" || (waitsOn(reported) && shows)) {
		return (
			<Dot
				role="status"
				aria-label="waiting on you"
				title={need.kind === "waiting" ? need.subject : undefined}
				color="bg-warning"
			/>
		);
	}
	if (need.kind === "idle") {
		// Empty, so what sits beside it lines up with the rows that have one.
		return <span className="size-3.5 shrink-0" />;
	}
	return (
		<span
			role="status"
			aria-label="working"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<Loader2Icon className="size-3.5 animate-spin text-foreground/60" />
		</span>
	);
}
