import type { TaskRecord } from "@splates/server/board";
import { HourglassIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { upNext } from "./blocked-fix";
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

/** A queued task that can start: its place in line, said plainly. */
export function WaitingPanel({ todo }: { todo: TaskRecord }): JSX.Element {
	const { todos, lanes } = useContext(Board);
	const ahead = upNext(todos).findIndex((each) => each.id === todo.id);
	return (
		<section
			role="status"
			aria-label="Queued"
			className="mb-3 flex flex-col gap-3 rounded-2xl border border-foreground/10 px-4 py-3 text-sm"
		>
			<div className="flex items-center gap-3">
				<HourglassIcon
					aria-hidden
					className="size-5 shrink-0 animate-pulse text-primary motion-reduce:animate-none"
				/>
				<Place ahead={ahead} />
			</div>
			<WaitList waits={waitsOn(todo, todos, lanes)} />
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

/** The tasks a task waits on, each with where it stands; nothing when it waits on none. */
function WaitList({ waits }: { waits: Wait[] }): JSX.Element | null {
	if (waits.length === 0) {
		return null;
	}
	return (
		<ul
			aria-label="Blockers"
			className="flex flex-col gap-1.5 rounded-lg bg-background/60 p-2"
		>
			{waits.map((wait) => (
				<li key={wait.id} className="flex items-center gap-2 px-1 text-sm">
					<span className="min-w-0 truncate text-muted-foreground text-xs tabular-nums">
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
	);
}
