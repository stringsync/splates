import type { EvalDetail } from "@stringsync/splates-server/evals/browser";
import { targetName } from "@stringsync/splates-server/evals/browser";
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
import { AgentIcon } from "./agent-icons";
import { evalRun } from "./api";
import { still, touchItems } from "./board";
import { Dispatching } from "./dispatching";

/** Whether a run's outcome is one worth improving: the agent did not do what the skill asks. */
export function improvable(status: string): boolean {
	return status === "fail";
}

/**
 * What asks an agent to improve the skill for `run`'s scenario: the
 * requirement, each check and the judge's reason that held it back, the reply,
 * and the way to re-run only that scenario, which the person starts from the
 * permission card.
 */
export function improvePrompt(run: EvalDetail): string {
	const held = [
		...run.checks
			.filter((check) => !check.pass)
			.map((check) => `- Check \`${check.id}\`: ${check.about}`),
		...(run.judge?.pass === false ? [`- Judge: ${run.judge.reason}`] : []),
	];
	return `An eval scenario is not passing. Improve the splates skill (\`skills/splates/\`) so it does, without special-casing the scenario.

Scenario: \`${run.scenario}\` (${run.aspect})
Requirement: ${run.requirement}
Agent: ${targetName(run.target)}, repetition ${run.repetition + 1}

It asked the agent:

${run.input}

What held it back:

${held.length === 0 ? "- nothing named; read the transcript" : held.join("\n")}

The agent's reply:

${run.reply || "(none)"}

The run, with its whole transcript, opens on the Evals page as \`${run.id}\`, under ~/.splates/evals.

Start a splates task for the change, and note the commit you branched from. When it is ready, ask the person to re-run only this scenario with the run evals permission card, naming \`${run.scenario}\` and setting \`Baseline:\` to that commit, so the re-run shows both skills side by side. Never start an eval yourself. The change lands only once the person approves it.`;
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
								<AgentIcon agent={each.id} name={each.name} />
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
