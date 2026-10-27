import type {
	ElsewhereBlocker,
	ElsewhereOpen,
} from "@stringsync/splates-server/board";
import { elsewhereName } from "@stringsync/splates-server/board/browser";
import { ExternalLinkIcon, XIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import { cn } from "#web/lib/utils.ts";
import { elsewhereTasks } from "./api";
import { Board } from "./board";

/**
 * The tasks of other projects it waits on, a chip each: named as
 * `webappwiz #404`, its × unlinks it.
 */
export function ElsewhereList({
	todoId,
	waiting,
	onRemove,
}: {
	todoId: number;
	waiting: ElsewhereBlocker[];
	onRemove: (blocker: ElsewhereBlocker) => void;
}): JSX.Element | null {
	const { elsewhere } = useContext(Board);
	const read = elsewhere?.blockers[todoId];
	if (waiting.length === 0) {
		return null;
	}
	return (
		<ul aria-label="Blocked by in other projects" className="contents">
			{waiting.map((blocker) => {
				const slug = read?.find(
					(each) => each.project === blocker.project && each.id === blocker.id,
				)?.slug;
				const name = elsewhereName({ ...blocker, slug });
				return (
					<li
						key={`${blocker.project}#${blocker.id}`}
						className="group/link inline-flex h-6 pointer-coarse:h-10 items-center rounded-md bg-muted/70 text-sm"
					>
						<Tooltip>
							<TooltipTrigger
								render={<span />}
								className={cn(
									"cursor-default pl-2 tabular-nums",
									blocker.lost && "text-warning line-through",
								)}
							>
								{name}
							</TooltipTrigger>
							<TooltipContent>{blocker.subject}</TooltipContent>
						</Tooltip>
						<button
							type="button"
							aria-label={`unlink ${name}`}
							onClick={() => onRemove(blocker)}
							className="flex h-full cursor-pointer items-center rounded-md px-1 pointer-coarse:px-3 text-muted-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover/link:text-muted-foreground"
						>
							<XIcon className="size-3" />
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * A button that opens a search over the open tasks of the other projects, by
 * project, number or words; picking one makes this todo wait on it.
 */
export function ElsewherePicker({
	exclude,
	onPick,
}: {
	exclude: ElsewhereBlocker[];
	onPick: (task: ElsewhereOpen) => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [tasks, setTasks] = useState<ElsewhereOpen[] | null>(null);
	const [failed, setFailed] = useState(false);
	const words = query.trim().toLowerCase();
	const shown = (tasks ?? []).filter(
		(other) =>
			!exclude.some(
				(blocker) =>
					blocker.project === other.project && blocker.id === other.id,
			) &&
			(words === "" ||
				elsewhereName(other).toLowerCase().includes(words) ||
				other.subject.toLowerCase().includes(words)),
	);
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				setQuery("");
				if (next) {
					setFailed(false);
					elsewhereTasks().then(setTasks, () => setFailed(true));
				}
			}}
		>
			<PopoverTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="Add a task of another project blocking this one"
						className="pointer-coarse:size-10"
						title="Add a task of another project blocking this one"
					/>
				}
			>
				<ExternalLinkIcon />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-2 p-2">
				<Input
					autoFocus
					aria-label="find a task of another project"
					placeholder="Project, number or words"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<ul className="flex max-h-64 flex-col overflow-y-auto">
					{(failed || tasks === null || shown.length === 0) && (
						<li className="px-2 py-1.5 text-muted-foreground text-sm">
							{failed
								? "Could not read the other projects"
								: tasks === null
									? "Reading the other projects…"
									: "No task matches"}
						</li>
					)}
					{shown.map((other) => (
						<li key={`${other.project}#${other.id}`}>
							<button
								type="button"
								onClick={() => {
									onPick(other);
									setOpen(false);
								}}
								className="flex w-full pointer-coarse:min-h-10 cursor-pointer items-baseline pointer-coarse:items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
							>
								<span className="text-muted-foreground tabular-nums">
									{elsewhereName(other)}
								</span>
								<span className="min-w-0 flex-1 truncate">{other.subject}</span>
							</button>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
