import type { EvalDetail } from "@splates/server/evals/browser";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { evalRun } from "./api";
import { still, touchItems } from "./board";
import { Dispatching } from "./dispatching";

/** Whether a batch is splates's own, whose scenarios test the splates skill; a framework's batch has nothing here to improve. */
export function ownBatch(producer: string | null): boolean {
	return producer === "splates";
}

/** Whether a run's outcome is one worth improving: the agent did not do what the skill asks. */
export function improvable(status: string): boolean {
	return status === "fail";
}

/**
 * What asks an agent to work the eval loop on `run`'s scenario: a splates
 * directive naming the run. It is text only, so any harness can follow it
 * without the splates page.
 */
export function improvePrompt(run: Pick<EvalDetail, "id">): string {
	return `[SPLATES EVAL LOOP ${run.id}]`;
}

/**
 * What asks an agent to work the eval loop from a scenario, which may have no
 * run yet: the directive names the scenario, then
 * optionally an `Agents:` line of the saved agents to run it on and a
 * `Repetitions:` line for how many times to run each. The agent
 * runs the scenario first, then carries on as from a failed run.
 */
export function scenarioPrompt(
	scenario: string | readonly string[],
	agents: readonly string[] = [],
	reps: number | null = null,
): string {
	const ids = typeof scenario === "string" ? [scenario] : scenario;
	const lines = [
		ids.length === 1
			? `[SPLATES EVAL LOOP scenario ${ids[0]}]`
			: `[SPLATES EVAL LOOP scenarios ${ids.join(" ")}]`,
	];
	if (agents.length > 0) {
		lines.push(`Agents: ${agents.map((agent) => `\`${agent}\``).join(", ")}`);
	}
	if (reps !== null) {
		lines.push(`Repetitions: ${reps}`);
	}
	return lines.join("\n");
}

/** Scenario ids grouped by namespace (the path before the last `/`), in order. */
export function byNamespace(ids: readonly string[]): string[][] {
	const groups = new Map<string, string[]>();
	for (const id of ids) {
		const namespace = id.slice(0, Math.max(id.lastIndexOf("/"), 0));
		groups.set(namespace, [...(groups.get(namespace) ?? []), id]);
	}
	return [...groups.values()];
}

/**
 * Improve this, for a failing or uncovered run: a menu of agents, each
 * starting a conversation told what the run did and how to fix it, which
 * it opens. `run` is the id of the run `load` opens when none is at hand.
 */
export function ImproveMenu({
	run,
	className,
}: {
	/** The run, or its id to read as an agent is picked. */
	run: EvalDetail | string;
	className?: string;
}): JSX.Element | null {
	const context = useContext(Dispatching);
	const [error, setError] = useState<string | null>(null);
	if (context === null) {
		return null;
	}
	const { dispatch, open } = context;
	const improve = (agent: string): void => {
		setError(null);
		(typeof run === "string" ? evalRun(run) : Promise.resolve(run))
			.then((detail) =>
				dispatch.beginWith({ agent }, null, improvePrompt(detail)),
			)
			.then(open)
			.catch((failed: unknown) =>
				setError(failed instanceof Error ? failed.message : String(failed)),
			);
	};
	return (
		<span className="flex items-center gap-2">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							size="sm"
							variant="outline"
							className={cn("w-fit gap-1 bg-transparent", className)}
							{...still}
						/>
					}
				>
					<WrenchIcon data-icon="inline-start" />
					Improve this
					<ChevronDownIcon className="text-muted-foreground" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className={cn("w-56", touchItems)}>
					<DropdownMenuGroup>
						<DropdownMenuLabel>Improve with</DropdownMenuLabel>
						{dispatch.agents.map((each) => (
							<DropdownMenuItem key={each.id} onClick={() => improve(each.id)}>
								<AgentMark agent={each.id} name={each.name} />
								{each.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{error !== null && (
				<span role="alert" className="text-destructive text-xs">
					{error}
				</span>
			)}
		</span>
	);
}
