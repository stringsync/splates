import type { TaskRecord } from "@splates/server/board";
import { type JSX, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { Board } from "./board";
import { CLAMP, CUT_FADE, useClamped } from "./clamped";
import { Markdown } from "./markdown";
import { planParts } from "./task-plan-parts";

/**
 * A task as a card: its number, lane, subject and what it asks. It leaves out
 * who works it and where it stands, which change while the card stays put.
 * Long details clamp to the same height limit as user messages and expand when
 * the card is clicked.
 */
export function TaskCard({ todo }: { todo: TaskRecord }): JSX.Element {
	const { lanes } = useContext(Board);
	const lane = lanes.find((each) => each.id === todo.lane)?.name;
	const detail = goalFirst(todo.text.trim());
	const hasDetail = detail !== "" && detail !== todo.subject;
	const { ref, open, more, interactive, triggerProps } = useClamped(
		`${todo.id}\0${detail}`,
	);
	return (
		<article
			aria-label={`Task #${todo.id}`}
			className="overflow-hidden rounded-2xl border border-foreground/10 bg-card text-card-foreground shadow-xs"
		>
			<div
				{...triggerProps}
				className={cn(
					"rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
					interactive && "cursor-pointer",
				)}
			>
				<header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 text-muted-foreground text-xs">
					<span className="font-medium tabular-nums">#{todo.id}</span>
					{lane !== undefined && <span className="truncate">{lane}</span>}
				</header>
				<div className="flex flex-col gap-2 px-4 pt-1 pb-3">
					<h2 className="font-semibold text-base leading-snug wrap-anywhere">
						{todo.subject}
					</h2>
					{hasDetail && (
						<div
							ref={ref}
							className={cn(
								"relative",
								!open && [CLAMP, "overflow-hidden"],
								!open && more && CUT_FADE,
							)}
						>
							<Markdown text={detail} className="text-sm" />
						</div>
					)}
				</div>
			</div>
		</article>
	);
}

/**
 * Older tasks written with `## Before` and `## After` still lead with their
 * goal on a task card, without showing Before and After headings.
 */
function goalFirst(text: string): string {
	if (text === "") {
		return "";
	}
	const parts = planParts(text);
	if (parts.before === "" && parts.goal === "") {
		return text;
	}
	return [parts.goal, parts.before, parts.steps, parts.notes]
		.filter((each) => each !== "")
		.join("\n\n");
}
