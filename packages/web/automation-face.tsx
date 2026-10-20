import type {
	AutomationRow,
	AutomationRun,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import {
	AUDIT_AUTOMATION,
	GROOMER_AUTOMATION,
} from "@stringsync/splates-server/hooks/browser";
import { ClockIcon, ListTodoIcon, TerminalIcon, ZapIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import { Dispatching } from "./dispatching";
import { ReferenceChip } from "./reference-chip";
import { Stamp } from "./stamp";
import { TaskIcon } from "./task-icon";

/**
 * An automation's mark: a violet tile with a zap for one a task event sets
 * off, or a clock for one on a schedule, as the sidebar marks the groomer's
 * conversation with the zap.
 */
export function AutomationMark({
	trigger,
}: {
	trigger: Trigger | null;
}): JSX.Element {
	const Icon = trigger === null || "event" in trigger ? ZapIcon : ClockIcon;
	return (
		<span
			aria-hidden
			className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15"
		>
			<Icon className="size-4 fill-violet-500/25 text-violet-600 dark:text-violet-400" />
		</span>
	);
}

/** Opens a task a run was for: by its number while queued, or by its name. */
export interface RunOpens {
	todo: (id: number) => void;
	task: (task: string) => void;
}

/**
 * What an automation is, beside its buttons: its mark, what sets it off,
 * who or what it runs, and when it last ran. The groomer and the notes
 * audit go by their names.
 */
export function AutomationFace({
	row,
	opens,
}: {
	row: AutomationRow;
	opens?: RunOpens | undefined;
}): JSX.Element {
	const adding = row.id === "";
	// Blank until the server labels what was added or saved.
	const pending = row.when === "";
	const named =
		row.id === GROOMER_AUTOMATION
			? "Groomer"
			: row.id === AUDIT_AUTOMATION
				? "Notes audit"
				: null;
	const when = adding ? "Adding…" : pending ? "Saving…" : row.when;
	const last = row.runs.at(-1);
	return (
		<div className="flex min-w-0 flex-1 gap-3">
			<AutomationMark trigger={row.trigger} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
					{named !== null ? (
						<span className="font-medium">{named}</span>
					) : (
						<>
							{!adding && (
								<span className="text-muted-foreground tabular-nums">
									{row.id}.
								</span>
							)}
							<span className="font-medium">{when}</span>
						</>
					)}
					{row.paused === true && <Badge variant="secondary">Paused</Badge>}
				</div>
				{named !== null && (
					<p className="text-muted-foreground text-xs">
						{pending
							? when
							: "event" in row.trigger
								? `On ${when}`
								: when.replace(/^./, (first) => first.toUpperCase())}
					</p>
				)}
				<Runs hook={row.hook} does={row.does} />
				{last !== undefined && <LastRun run={last} opens={opens} />}
			</div>
		</div>
	);
}

/**
 * When an automation last ran, the task it ran for, by its name once one took
 * it, each opening it given `opens`, and whether it failed, why on hover.
 */
function LastRun({
	run,
	opens,
}: {
	run: AutomationRun;
	opens: RunOpens | undefined;
}): JSX.Element {
	const { todos, task } = ranFor(run.on);
	return (
		<div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
			Last ran <Stamp at={run.at} />
			{task === null &&
				todos.map((id) => (
					<ReferenceChip
						key={id}
						Icon={ListTodoIcon}
						kind={`#${id}`}
						name=""
						title={`Task #${id}`}
						open={opens && (() => opens.todo(id))}
						inline
					/>
				))}
			{task !== null && (
				<ReferenceChip
					Icon={TaskIcon}
					kind=""
					name={task}
					title={task}
					open={opens && (() => opens.task(task))}
					inline
				/>
			)}
			{run.error !== null && (
				<span title={run.error} className="text-destructive">
					Failed
				</span>
			)}
		</div>
	);
}

/** The tasks a run's `on` names: `task.created #3 fix-x` is #3 and fix-x; `schedule` none. */
export function ranFor(on: string): { todos: number[]; task: string | null } {
	const [, ...named] = on.split(" ");
	const todos = named
		.filter((each) => /^#\d+$/.test(each))
		.map((each) => Number(each.slice(1)));
	const task = named.find((each) => !each.startsWith("#")) ?? null;
	return { todos, task };
}

/**
 * What `hook` runs: the agent it tells, by its mark and pick, and what it is
 * told; or the command, in mono. Without the page's agents, the server's
 * words for it, `does`.
 */
function Runs({ hook, does }: { hook: Hook; does: string }): JSX.Element {
	const context = useContext(Dispatching);
	if (hook.kind === "run") {
		return (
			<p className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-sm">
				<TerminalIcon className="size-3.5 shrink-0" />
				<code className="min-w-0 truncate font-mono text-xs">
					{hook.command}
				</code>
			</p>
		);
	}
	if (context === null) {
		return <p className="break-words text-muted-foreground text-sm">{does}</p>;
	}
	const { dispatch } = context;
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<p className="flex min-w-0 items-center gap-1.5 text-sm">
				<AgentIcon
					agent={hook.agent}
					name={dispatch.agentName(hook.agent)}
					className="size-3.5"
				/>
				<span className="truncate">{dispatch.pickName(hook)}</span>
			</p>
			<p
				className={cn(
					"break-words text-muted-foreground text-sm",
					hook.kind === "agent" && "line-clamp-3 whitespace-pre-wrap",
				)}
			>
				{hook.kind === "agent"
					? hook.prompt
					: "Grooms each task deferred rough to the backlog, then marks it ready, and finds lanes for Untriaged tasks."}
			</p>
		</div>
	);
}
