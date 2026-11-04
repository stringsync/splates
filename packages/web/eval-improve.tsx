import type { EvalDetail } from "@splates/server/evals/browser";
import {
	DEFAULT_EVAL_BUDGET,
	type EvalBudget,
} from "@splates/server/evals/browser";
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
 * directive naming the run, then the loop's dollar budget and round cap as
 * plain text lines. The skill's SKILL.md maps it to its `references/evals.md`,
 * which says how to read the run and the limits and work the loop. It is text
 * only, so any harness can follow it without the splates page.
 */
export function improvePrompt(
	run: Pick<EvalDetail, "id">,
	limits: EvalBudget = DEFAULT_EVAL_BUDGET,
): string {
	return `[SPLATES EVAL LOOP ${run.id}]\nBudget: $${limits.usd}\nRounds: ${limits.rounds}`;
}

/**
 * What asks an agent to work the eval loop from a scenario, which may have no
 * run yet: the directive names the scenario, then the budget and rounds, then
 * optionally an `Agents:` line of the saved agents to run it on and a
 * `Repetitions:` line for how many times to run each. The agent
 * runs the scenario first, then carries on as from a failed run.
 */
export function scenarioPrompt(
	scenario: string,
	limits: EvalBudget = DEFAULT_EVAL_BUDGET,
	agents: readonly string[] = [],
	reps: number | null = null,
): string {
	const lines = [
		`[SPLATES EVAL LOOP scenario ${scenario}]`,
		`Budget: $${limits.usd}`,
		`Rounds: ${limits.rounds}`,
	];
	if (agents.length > 0) {
		lines.push(`Agents: ${agents.map((agent) => `\`${agent}\``).join(", ")}`);
	}
	if (reps !== null) {
		lines.push(`Repetitions: ${reps}`);
	}
	return lines.join("\n");
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
	const [limits, setLimits] = useState<EvalBudget>({ ...DEFAULT_EVAL_BUDGET });
	if (context === null) {
		return null;
	}
	const { dispatch, open } = context;
	const improve = (agent: string): void => {
		setError(null);
		(typeof run === "string" ? evalRun(run) : Promise.resolve(run))
			.then((detail) =>
				dispatch.beginWith({ agent }, null, improvePrompt(detail, limits)),
			)
			.then(open)
			.catch((failed: unknown) =>
				setError(failed instanceof Error ? failed.message : String(failed)),
			);
	};
	return (
		<span className="flex items-center gap-2">
			<label className="flex items-center gap-1 text-xs">
				Budget ($)
				<input
					aria-label="Budget in dollars"
					className="w-16 rounded border p-1"
					type="number"
					min={0.01}
					step="any"
					value={limits.usd}
					onChange={(event) =>
						setLimits({ ...limits, usd: Number(event.target.value) })
					}
				/>
			</label>
			<label className="flex items-center gap-1 text-xs">
				Rounds
				<input
					aria-label="Max rounds"
					className="w-14 rounded border p-1"
					type="number"
					min={1}
					step={1}
					value={limits.rounds}
					onChange={(event) =>
						setLimits({ ...limits, rounds: Number(event.target.value) })
					}
				/>
			</label>
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
