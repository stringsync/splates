import type {
	AutomationRow,
	AutomationRun,
	Hook,
	Trigger,
} from "@splates/server/hooks";
import { BY_HAND } from "@splates/server/hooks/browser";
import {
	ChevronDownIcon,
	ClockIcon,
	ListTodoIcon,
	TerminalIcon,
	ZapIcon,
} from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import { AUTO_PICK_NAME, AutoIcon } from "./auto-brand";
import { Dispatching } from "./dispatching";
import { dollars } from "./eval-status";
import { Markdown } from "./markdown";
import { ReferenceChip } from "./reference-chip";
import { Stamp } from "./stamp";
import { TaskIcon } from "./task-icon";

/**
 * An automation's mark: a violet tile with a zap for one a task event sets
 * off, or a clock for one on a schedule.
 */
export function AutomationMark({
	trigger,
}: {
	trigger: Trigger | null;
}): JSX.Element {
	const Icon =
		trigger === null || "event" in trigger || "signal" in trigger
			? ZapIcon
			: ClockIcon;
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
 * What an automation is: a header of its mark, what sets it off, who or what
 * it runs and `actions` (its buttons) at the end; under it, across the card's
 * whole width, what the agent is told, as Markdown, and when it last ran.
 */
export function AutomationFace({
	row,
	opens,
	saving = false,
	actions,
}: {
	row: AutomationRow;
	opens?: RunOpens | undefined;
	/** Whether a change to it awaits the server. */
	saving?: boolean | undefined;
	actions?: ReactNode;
}): JSX.Element {
	const adding = row.id === "";
	const pending = adding || saving;
	const named = row.name ?? null;
	const when = adding ? "Adding…" : pending ? "Saving…" : row.when;
	const last = row.runs.at(-1);
	const told = row.hook.kind === "agent" ? row.hook.prompt : null;
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-2">
			<div className="flex min-w-0 items-start gap-3">
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
								<span className="min-w-0 break-words font-medium">
									{!pending && "signal" in row.trigger ? (
										<>
											On{" "}
											<code className="rounded bg-muted px-1 py-0.5 font-mono font-normal text-xs">
												{row.trigger.signal}
											</code>
										</>
									) : (
										when
									)}
								</span>
							</>
						)}
						{row.finishedAt !== undefined ? (
							<Badge variant="secondary">Finished</Badge>
						) : (
							row.paused === true && <Badge variant="secondary">Paused</Badge>
						)}
						{row.hook.kind === "agent" && row.hook.evalBudget !== undefined && (
							<Badge variant="secondary" className="tabular-nums">
								{dollars(row.hook.evalBudget)} eval budget
							</Badge>
						)}
					</div>
					{named !== null && (
						<p className="min-w-0 break-words text-muted-foreground text-xs">
							{pending ? (
								when
							) : "signal" in row.trigger ? (
								<>
									On{" "}
									<code className="rounded bg-muted px-1 py-0.5 font-mono">
										{row.trigger.signal}
									</code>
								</>
							) : "event" in row.trigger ? (
								`On ${when}`
							) : (
								when.replace(/^./, (first) => first.toUpperCase())
							)}
						</p>
					)}
					<Runs hook={row.hook} does={row.does} />
				</div>
				{actions}
			</div>
			{(told !== null || last !== undefined) && (
				<div className="flex min-w-0 flex-col gap-1 sm:pl-11">
					{told !== null && <Told prompt={told} />}
					{last !== undefined && (
						<LastRun
							run={last}
							opens={"event" in row.trigger ? opens : undefined}
							chips={"event" in row.trigger}
						/>
					)}
				</div>
			)}
		</div>
	);
}

/** How tall a prompt shows before "Show full prompt", about nine lines. */
const FOLDED = "max-h-[11.5rem]";

/**
 * What an agent is told, as Markdown, folded to a few lines under a fade
 * with "Show full prompt" when it runs longer, and "Show less" once open.
 */
function Told({ prompt }: { prompt: string }): JSX.Element {
	const body = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [long, setLong] = useState(false);
	useLayoutEffect(() => {
		const element = body.current;
		if (element === null || open) {
			return;
		}
		const measure = () =>
			setLong(element.scrollHeight > element.clientHeight + 1);
		measure();
		const resized = new ResizeObserver(measure);
		resized.observe(element);
		return () => resized.disconnect();
	}, [open]);
	return (
		<div className="flex min-w-0 flex-col items-start gap-1">
			<div
				ref={body}
				className={cn(
					"w-full max-w-[72ch] text-muted-foreground text-sm",
					!open &&
						cn(
							FOLDED,
							"overflow-hidden",
							long &&
								"[mask-image:linear-gradient(to_bottom,#000_60%,transparent)]",
						),
				)}
			>
				<Markdown text={prompt} />
			</div>
			{(long || open) && (
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="flex items-center gap-1 py-0.5 font-medium text-primary text-sm"
				>
					{open ? "Show less" : "Show full prompt"}
					<ChevronDownIcon
						className={cn(
							"size-3.5 transition-transform",
							open && "rotate-180",
						)}
					/>
				</button>
			)}
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
	chips,
}: {
	run: AutomationRun;
	opens: RunOpens | undefined;
	/** Whether the run names the tasks it was for, as a task event's does; a signal's or a schedule's names none. */
	chips: boolean;
}): JSX.Element {
	const { todos, task } = chips ? ranFor(run.on) : { todos: [], task: null };
	return (
		<div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
			Last ran <Stamp at={run.at} />
			{run.on === BY_HAND && " by hand"}
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

/** The tasks a run's `on` names: `task.created #3 fix-x` is #3 and fix-x; `schedule` or `by hand` none. */
export function ranFor(on: string): { todos: number[]; task: string | null } {
	if (on === BY_HAND) {
		return { todos: [], task: null };
	}
	const [, ...named] = on.split(" ");
	const todos = named
		.filter((each) => /^#\d+$/.test(each))
		.map((each) => Number(each.slice(1)));
	const task = named.find((each) => !each.startsWith("#")) ?? null;
	return { todos, task };
}

/**
 * What `hook` runs: the agent it tells, by its mark and pick; or the command,
 * in mono. Without the page's agents, the server's words for it, `does`,
 * short of the prompt.
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
		// The prompt shows under the header, so not again at the end of `does`.
		const told = `: ${hook.prompt}`;
		return (
			<p className="truncate text-muted-foreground text-sm">
				{does.endsWith(told) ? does.slice(0, -told.length) : does}
			</p>
		);
	}
	const { dispatch } = context;
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<p className="flex min-w-0 items-center gap-1.5 text-sm">
				{hook.agent === undefined ? (
					<>
						<AutoIcon colored className="size-3.5 shrink-0" />
						<span className="truncate">{AUTO_PICK_NAME}</span>
					</>
				) : (
					<>
						<AgentIcon
							agent={hook.agent}
							name={dispatch.agentName(hook.agent)}
							className="size-3.5"
						/>
						<span className="truncate">
							{dispatch.pickName({ ...hook, agent: hook.agent })}
						</span>
					</>
				)}
			</p>
		</div>
	);
}
