import {
	type DemoPoint,
	sectionApart,
} from "@stringsync/splates-server/plans/browser";
import { PlayIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { DialogClose } from "#web/components/ui/dialog.tsx";
import { Dispatching } from "./dispatching";
import { HEADING, Markdown } from "./markdown";

/** The points a demo shows a task at, as its buttons name them. */
const POINTS: { point: DemoPoint; label: string }[] = [
	{ point: "before", label: "Before" },
	{ point: "after", label: "After" },
	{ point: "main", label: "Main" },
];

/**
 * A task's `SPLATES.md` as its dialog shows it: `## Verification` first, the
 * evidence the user reads instead of a demo, then a demo to start at each
 * point, when it says how to set one up under `## Demo`, then the rest.
 */
export function TaskPlan({
	task,
	conversation,
	plan,
	render = (text) => text,
}: {
	task: string;
	/** The conversation that last worked it, null to let the page find one. */
	conversation: string | null;
	plan: string;
	/** What the rest of the plan reads as before it shows. */
	render?: (text: string) => string;
}): JSX.Element {
	const { section, rest } = sectionApart(plan, "Verification");
	const demo = sectionApart(plan, "Demo").section !== null;
	return (
		<>
			{section !== null && (
				<section aria-label="verification" className="flex min-w-0 flex-col">
					<Markdown text={section} />
				</section>
			)}
			{demo && <DemoButtons task={task} conversation={conversation} />}
			<Markdown text={render(rest.replace(/^\s*#\s[^\n]*/, ""))} />
		</>
	);
}

/**
 * Before, After and Main: each asks the conversation that last worked `task`
 * for its demo at that point and opens it, closing the dialog; a conversation
 * gone, or none, is started for it. None while the page holds no conversations.
 */
export function DemoButtons({
	task,
	conversation,
}: {
	task: string;
	conversation: string | null;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	if (context === null) {
		return null;
	}
	const show = (point: DemoPoint) => {
		void context.dispatch.demo(task, conversation, point).then(context.open);
	};
	return (
		<section aria-label="demo" className="flex min-w-0 flex-col gap-1">
			<h2 className={HEADING}>Demo</h2>
			<div className="flex flex-wrap gap-1.5">
				{POINTS.map(({ point, label }) => (
					<DialogClose
						key={point}
						render={
							<Button
								size="sm"
								variant="outline"
								aria-label={`Demo ${label.toLowerCase()}`}
								onClick={() => show(point)}
							/>
						}
					>
						<PlayIcon />
						{label}
					</DialogClose>
				))}
			</div>
		</section>
	);
}
