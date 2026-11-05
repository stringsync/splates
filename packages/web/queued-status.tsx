import type { TaskRecord } from "@splates/server/board";
import {
	ArrowUpRightIcon,
	HourglassIcon,
	ListPlusIcon,
	Loader2Icon,
	TriangleAlertIcon,
	Unlink2Icon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { type BlockedFix, fixLabel, upNext, useApplyFix } from "./blocked-fix";
import { Board } from "./board";
import { TONES } from "./task-sections";
import { type Wait, waitsOn } from "./waits-on";

/** How each state of a blocker reads: tones the task dialog's labels use. */
const WAIT_TONES: Record<Wait["state"], string> = {
	running: TONES.working,
	queued: TONES.working,
	"not queued": TONES.waiting,
	removed: TONES.failed,
	"another project": TONES.quiet,
};

/** What a blocked task is held back by, and the one step that frees it. */
export function BlockedPanel({
	todo,
	fix,
}: {
	todo: TaskRecord;
	fix: BlockedFix | null;
}): JSX.Element {
	const { todos, lanes } = useContext(Board);
	const waits = waitsOn(todo, todos, lanes);
	return (
		<section
			role="alert"
			aria-label="Blocked"
			className="flex flex-col gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4"
		>
			<div className="flex items-start gap-3">
				<TriangleAlertIcon
					aria-hidden
					className="mt-0.5 size-5 shrink-0 text-warning"
				/>
				<div className="flex min-w-0 flex-col gap-0.5">
					<p className="font-medium text-sm">This will not start yet</p>
					<p className="text-muted-foreground text-sm">{reason(fix)}</p>
				</div>
			</div>
			{waits.length > 0 && (
				<ul className="flex flex-col gap-1.5 rounded-lg bg-background/60 p-2">
					{waits.map((wait) => (
						<li key={wait.id} className="flex items-center gap-2 px-1 text-sm">
							<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
								{wait.label}
							</span>
							<span className="min-w-0 flex-1 truncate">{wait.subject}</span>
							<span
								className={cn(
									"shrink-0 rounded-md px-1.5 py-px font-medium text-xs",
									WAIT_TONES[wait.state],
								)}
							>
								{wait.state}
							</span>
						</li>
					))}
				</ul>
			)}
			{fix !== null && <FixButton todo={todo} fix={fix} />}
		</section>
	);
}

/** Why the task is held back, in words that point to the button below. */
function reason(fix: BlockedFix | null): string {
	switch (fix?.kind) {
		case "queue":
			return fix.chain.length === 1
				? "It waits on a task nobody has queued, so no agent will start it."
				: "It waits on tasks nobody has queued, so no agent will start it.";
		case "drop":
			return "It waits on a task that was removed without merging, so it can never start.";
		case "with":
			return `It waits on the same tasks as #${fix.id}, which cannot start yet. Free #${fix.id} and this one follows.`;
		default:
			return "It waits on tasks that must land first.";
	}
}

/** The step that frees a blocked task, as a button as large as the need for it. */
function FixButton({
	todo,
	fix,
}: {
	todo: TaskRecord;
	fix: BlockedFix;
}): JSX.Element {
	const { open, refuseTodo } = useContext(Board);
	const apply = useApplyFix();
	const [busy, setBusy] = useState(false);
	if (fix.kind === "with") {
		return (
			<Button variant="outline" onClick={() => open(fix.id)} className="w-fit">
				Go to #{fix.id}
				<ArrowUpRightIcon data-icon="inline-end" />
			</Button>
		);
	}
	const Icon = fix.kind === "queue" ? ListPlusIcon : Unlink2Icon;
	return (
		<Button
			disabled={busy}
			className="w-fit"
			onClick={() => {
				setBusy(true);
				void apply(todo, fix)
					.catch((error: unknown) =>
						refuseTodo(
							todo.id,
							fix.kind === "queue" ? "Blockers not queued" : "Not unlinked",
							error,
						),
					)
					.finally(() => setBusy(false));
			}}
		>
			{busy ? (
				<Loader2Icon data-icon="inline-start" className="animate-spin" />
			) : (
				<Icon data-icon="inline-start" />
			)}
			{fixLabel(fix)}
		</Button>
	);
}

/** A queued task that can start: its place in line, said plainly. */
export function WaitingPanel({ todo }: { todo: TaskRecord }): JSX.Element {
	const { todos } = useContext(Board);
	const ahead = upNext(todos).findIndex((each) => each.id === todo.id);
	return (
		<section
			role="status"
			aria-label="Queued"
			className="mb-3 flex items-center gap-3 rounded-2xl border border-foreground/10 px-4 py-3 text-sm"
		>
			<HourglassIcon
				aria-hidden
				className="size-5 shrink-0 animate-pulse text-primary motion-reduce:animate-none"
			/>
			<Place ahead={ahead} />
		</section>
	);
}

function Place({ ahead }: { ahead: number }): ReactNode {
	if (ahead <= 0) {
		return (
			<p>
				<span className="font-medium">Next in line.</span>{" "}
				<span className="text-muted-foreground">
					An agent takes it as soon as one is free.
				</span>
			</p>
		);
	}
	return (
		<p>
			<span className="font-medium">
				{ahead === 1 ? "1 task" : `${ahead} tasks`} ahead.
			</span>{" "}
			<span className="text-muted-foreground">
				An agent takes it once those are under way.
			</span>
		</p>
	);
}
