import { CheckIcon, Loader2Icon, PowerIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { DialogTitle } from "#dev/components/ui/dialog.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ProjectConversation } from "./project-api";

/** How a checkpoint stands. */
export interface Standing {
	asked: ProjectConversation[];
	/** Still to answer. */
	going: number;
	missed: ProjectConversation[];
}

/**
 * Where the dialog is: picking projects, counting down to an auto update,
 * waiting on agents, done with them
 * before `arbor dev` goes, waiting on it to restart, back from a restart with no
 * agent to resume, its agents being told to carry on after the restart, or
 * ended with them carrying on; or waiting on `arbor dev` to shut down, and
 * gone once it has.
 */
export type Slide =
	| "pick"
	| "counting"
	| "going"
	| "done"
	| "restarting"
	| "restarted"
	| "resuming"
	| "ended"
	| "shuttingDown"
	| "shutDown";

export function slideOf({ asked, going }: Standing): Slide {
	return asked.length === 0 ? "pick" : going > 0 ? "going" : "done";
}

/** What follows the checkpoint under way: a restart, a shutdown, or neither. */
export type Run = "restart" | "shutdown" | null;

/**
 * The dialog's title, and the menu item's, the same for a whole run, so a
 * restart reads as one thing happening rather than a phase at a time.
 */
export function titleOf(
	slide: Slide,
	run: Run,
	restarted: boolean,
	updating = false,
): string {
	if (updating) {
		return "Updating arbor dev";
	}
	switch (slide) {
		case "pick":
			return "Power";
		case "counting":
			return "Updating arbor dev";
		case "going":
			return run === "restart"
				? "Restarting arbor dev"
				: run === "shutdown"
					? "Shutting down arbor dev"
					: "Checkpointing agents";
		case "restarting":
		case "resuming":
			return "Restarting arbor dev";
		case "restarted":
			return "arbor dev restarted";
		case "ended":
			return restarted ? "arbor dev restarted" : "Agents resumed";
		case "shuttingDown":
			return "Shutting down arbor dev";
		case "shutDown":
			return "arbor dev shut down";
		case "done":
			return "Agents checkpointed";
	}
}

/** The dialog's title, with Power's icon. */
export function PowerTitle({ title }: { title: ReactNode }): JSX.Element {
	return (
		<DialogTitle className="flex items-center gap-2">
			<PowerIcon aria-hidden className="size-4" />
			{title}
		</DialogTitle>
	);
}

/** One step of a run, and how far it has got. */
export interface Step {
	label: string;
	state: "done" | "now" | "todo";
}

/**
 * The steps of the run `slide` is in: a checkpoint when `checkpointed`, then
 * a restart, and a resume when `resumes`, or a shutdown.
 */
export function stepsOf(
	slide: Slide,
	run: Run,
	{ checkpointed, resumes }: { checkpointed: boolean; resumes: boolean },
): Step[] {
	const shutdown =
		run === "shutdown" || slide === "shuttingDown" || slide === "shutDown";
	const restart =
		!shutdown &&
		(run === "restart" ||
			slide === "counting" ||
			slide === "restarting" ||
			slide === "restarted" ||
			slide === "resuming" ||
			slide === "ended");
	// How far along the run is: steps before it are done, it is under way.
	const at =
		slide === "going" || slide === "counting"
			? 0
			: slide === "restarting" || slide === "shuttingDown"
				? 1
				: slide === "resuming"
					? 2
					: 3;
	const all: { label: string; index: number }[] = [
		...(checkpointed ? [{ label: "Checkpoint", index: 0 }] : []),
		...(shutdown ? [{ label: "Shut down", index: 1 }] : []),
		...(restart ? [{ label: "Restart", index: 1 }] : []),
		...(restart && resumes ? [{ label: "Resume", index: 2 }] : []),
	];
	return all.map(({ label, index }) => ({
		label,
		state: index < at ? "done" : index > at ? "todo" : "now",
	}));
}

/** The run's steps in a line, the one under way spinning. */
export function Steps({ steps }: { steps: Step[] }): JSX.Element | null {
	if (steps.length === 0) {
		return null;
	}
	return (
		<ol aria-label="steps" className="flex items-center gap-2 text-sm">
			{steps.map((step, index) => (
				<li
					key={step.label}
					aria-current={step.state === "now" ? "step" : undefined}
					className={cn(
						"flex items-center gap-1.5",
						step.state === "todo" && "text-muted-foreground",
					)}
				>
					{index > 0 && (
						<span aria-hidden className="mr-0.5 h-px w-4 bg-border" />
					)}
					<StepIcon state={step.state} />
					{step.label}
				</li>
			))}
		</ol>
	);
}

function StepIcon({ state }: { state: Step["state"] }): JSX.Element {
	switch (state) {
		case "done":
			return <CheckIcon aria-hidden className="size-3.5 text-success" />;
		case "now":
			return (
				<Loader2Icon
					aria-hidden
					className="size-3.5 animate-spin text-muted-foreground"
				/>
			);
		case "todo":
			return (
				<span
					aria-hidden
					className="size-3.5 rounded-full border border-muted-foreground/40"
				/>
			);
	}
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
