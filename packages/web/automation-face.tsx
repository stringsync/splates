import type {
	AutomationRow,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import { GROOMER_AUTOMATION } from "@stringsync/splates-server/hooks/browser";
import { ClockIcon, TerminalIcon, ZapIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import { Dispatching } from "./dispatching";
import { Stamp } from "./stamp";

/** The violet of an automation, as the sidebar marks the groomer's conversation. */
export const AUTOMATION_TINT = "border-violet-500/25 bg-violet-500/[0.04]";

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

/**
 * What an automation is, beside its buttons: its mark, what sets it off,
 * who or what it runs, and its last runs. The groomer goes by its name.
 */
export function AutomationFace({ row }: { row: AutomationRow }): JSX.Element {
	const adding = row.id === "";
	// Blank until the server labels what was added or saved.
	const pending = row.when === "";
	const groomer = row.id === GROOMER_AUTOMATION;
	const when = adding ? "Adding…" : pending ? "Saving…" : row.when;
	return (
		<div className="flex min-w-0 flex-1 gap-3">
			<AutomationMark trigger={row.trigger} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
					{groomer ? (
						<span className="font-medium">Groomer</span>
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
				{groomer && (
					<p className="text-muted-foreground text-xs">
						{pending ? when : `On ${when}`}
					</p>
				)}
				<Runs hook={row.hook} does={row.does} />
				{row.runs.length > 0 && (
					<ul
						aria-label="last runs"
						className="mt-1 flex flex-col gap-0.5 border-violet-500/20 border-l-2 pl-2 text-xs"
					>
						{row.runs.toReversed().map((run) => (
							<li key={run.at} className="flex min-w-0 items-baseline gap-2">
								<Stamp at={run.at} />
								<span className="text-muted-foreground">{run.on}</span>
								{run.error !== null && (
									<span className="min-w-0 truncate text-destructive">
										{run.error}
									</span>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
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
					: "Grooms each task deferred rough to the backlog, then marks it ready."}
			</p>
		</div>
	);
}
