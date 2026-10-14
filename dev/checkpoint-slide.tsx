import { FlagIcon, Loader2Icon, PlayIcon, RotateCwIcon } from "lucide-react";
import type { JSX } from "react";
import { DialogTitle } from "#dev/components/ui/dialog.tsx";
import type { ProjectConversation } from "./project-api";

/** How a checkpoint stands. */
export interface Standing {
	asked: ProjectConversation[];
	/** Still to answer. */
	going: number;
	missed: ProjectConversation[];
}

/**
 * Where the dialog is: picking projects, waiting on agents, done with them
 * stopped, waiting on `arbor dev` to restart, back from a restart with no
 * agent to resume, its agents being told to carry on after the restart, or
 * ended with them carrying on.
 */
export type Slide =
	| "pick"
	| "going"
	| "done"
	| "restarting"
	| "restarted"
	| "resuming"
	| "ended";

export function slideOf({ asked, going }: Standing): Slide {
	return asked.length === 0 ? "pick" : going > 0 ? "going" : "done";
}

/**
 * How each slide stands, for the title menu's Checkpoint, its own so moving
 * on is plain to see; done says `arbor dev` restarted when its agents wait to
 * resume on the new run. The dialog itself is titled by its phase.
 */
export function titleOf(slide: Slide, restarted: string | null): string {
	switch (slide) {
		case "pick":
			return "Checkpoint";
		case "going":
			return "Checkpoint under way";
		case "done":
			return restarted === null ? "Checkpoint done" : "arbor dev restarted";
		case "restarting":
			return "Restarting arbor dev";
		case "restarted":
			return "arbor dev restarted";
		case "resuming":
			return "Resuming agents";
		case "ended":
			return "Agents resumed";
	}
}

/**
 * The three phases the dialog walks through, as "Checkpoint, restart and
 * resume" names them, each with its icon; done is still the checkpoint until
 * a restart has followed it.
 */
const PHASES = {
	checkpoint: { title: "Checkpoint", Icon: FlagIcon },
	restart: { title: "Restart", Icon: RotateCwIcon },
	resume: { title: "Resume", Icon: PlayIcon },
};

/**
 * The dialog's title: the phase it is in, with its icon, which spins while
 * `arbor dev` restarts.
 */
export function PhaseTitle({
	slide,
	restarted,
}: {
	slide: Slide;
	restarted: string | null;
}): JSX.Element {
	const { title, Icon } = PHASES[phaseOf(slide, restarted)];
	return (
		<DialogTitle className="flex items-center gap-2">
			{slide === "restarting" ? (
				<Loader2Icon aria-hidden className="size-4 animate-spin" />
			) : (
				<Icon aria-hidden className="size-4" />
			)}
			{title}
		</DialogTitle>
	);
}

/** What a done checkpoint came to, in a sentence, its agents `then`. */
export function summary(
	standing: Standing,
	then: "stopped" | "waiting to resume",
): string {
	return `${plural(standing.asked.length - standing.missed.length)} checkpointed and ${then}.${missing(standing)}`;
}

/** Those a checkpoint missed, in a sentence after another, if any. */
export function missing({ missed }: Standing): string {
	return missed.length === 0
		? ""
		: ` ${missed.length} missed: ${missed.map((each) => each.name).join(", ")}.`;
}

/** `count` agents, in words. */
export function plural(count: number): string {
	return `${count} ${count === 1 ? "agent" : "agents"}`;
}

export function standing(conversations: ProjectConversation[]): Standing {
	const asked = conversations.filter((each) => each.checkpoint !== null);
	return {
		asked,
		going: asked.filter((each) => each.checkpoint === "asked").length,
		missed: asked.filter(
			(each) =>
				each.checkpoint === "failed" || each.checkpoint === "unanswered",
		),
	};
}

function phaseOf(slide: Slide, restarted: string | null): keyof typeof PHASES {
	switch (slide) {
		case "pick":
		case "going":
			return "checkpoint";
		case "done":
			return restarted === null ? "checkpoint" : "restart";
		case "restarting":
		case "restarted":
			return "restart";
		case "resuming":
		case "ended":
			return "resume";
	}
}
