import type { AgentPick } from "../models";
import type { EvalAsk } from "../plans/permission";
import { type EvalBudgetView, fitsEvalBudget } from "./auto";
import type {
	EvalCommands,
	EvalLaunch,
	EvalLaunchSpec,
	EvalPlan,
} from "./launch";
import { targetOf } from "./target";

/** What starting a card's round reads and calls. */
export interface EvalAutoStartDeps {
	/** The saved eval agents, as the card picks from them. */
	savedAgents(): Promise<AgentPick[]>;
	launches: {
		get(commands: EvalCommands, key: string): Promise<EvalLaunch | null>;
		plan(
			commands: EvalCommands,
			spec: Omit<EvalLaunchSpec, "key">,
		): Promise<EvalPlan>;
		budget(conversation: string): Promise<EvalBudgetView>;
		start(commands: EvalCommands, spec: EvalLaunchSpec): Promise<EvalLaunch>;
	};
}

/** The card a conversation's turn ended on, and where that conversation works. */
export interface EvalAutoCard {
	ask: EvalAsk;
	/** The card's key, as the page names it (`evalCardKey`). */
	key: string;
	conversation: string;
	/** Its task worktree; null to run at the project's root. */
	cwd: string | null;
}

/**
 * What became of a run card: its round started, or it waits because the
 * round's ceiling does not fit what is left of the conversation's budget.
 */
export type EvalAutoStart =
	| { started: EvalLaunch }
	| { short: { ceiling: number; budget: EvalBudgetView } };

/**
 * Starts the round a run-evals card asks for, on the agents the card names,
 * when the conversation's spend since its budget was approved plus the
 * plan's ceiling fits that budget: the approved budget card is the
 * permission. Answers what became of it, or null when it cannot run at all
 * (no runner, no agent, no ceiling, a refused plan, a card already run).
 */
export async function autoStartEvalCard(
	deps: EvalAutoStartDeps,
	commands: EvalCommands,
	card: EvalAutoCard,
): Promise<EvalAutoStart | null> {
	if (commands.run === null) {
		return null;
	}
	const saved = await deps.savedAgents();
	const named = card.ask.agents;
	const agents =
		named === undefined
			? saved.slice(0, 1)
			: saved.filter((pick) => named.includes(targetOf(pick)));
	if (agents.length === 0) {
		return null;
	}
	// A card already run, before a restart say, is not run again.
	if ((await deps.launches.get(commands, card.key)) !== null) {
		return null;
	}
	const spec: Omit<EvalLaunchSpec, "key"> = {
		skill: card.ask.skill,
		scenarios: card.ask.scenarios,
		agents,
		baseline: card.ask.baseline,
		reps: card.ask.reps ?? 1,
		conversation: card.conversation,
		cwd: card.cwd,
	};
	const plan = await deps.launches.plan(commands, spec);
	if (plan.refused || plan.usd === null) {
		return null;
	}
	const budget = await deps.launches.budget(card.conversation);
	if (!fitsEvalBudget(budget.usd, budget.spent, plan.usd)) {
		return { short: { ceiling: plan.usd, budget } };
	}
	return {
		started: await deps.launches.start(commands, {
			...spec,
			key: card.key,
			auto: true,
		}),
	};
}

/**
 * What tells the agent its run card waits for a budget: what the round may
 * cost, what is left, and to ask for more with an eval budget card.
 */
export function evalBudgetShortPrompt(
	ceiling: number,
	budget: EvalBudgetView,
): string {
	const left = Math.max(0, budget.usd - budget.spent);
	const need = Math.ceil((ceiling - left) * 100) / 100;
	const stands =
		budget.usd === 0
			? "this conversation has no eval budget approved yet"
			: `this conversation has ${dollars(left)} left of the ${dollars(budget.usd)} eval budget approved for it`;
	const ask = budget.usd === 0 ? "a budget" : `at least ${dollars(need)} more`;
	return `Your run card waits for a budget: this round may cost up to ${dollars(ceiling)}, and ${stands}. Ask for ${ask} with an eval budget card (\`## 🔐 Permission: eval budget: <what for>\`, an \`Asks: $<amount>\` line and \`Round: up to ${dollars(ceiling)}\`), and end your turn on it; once it is approved, send the run card again.`;
}

/** The line an eval round's report ends with: what the conversation's budget stands at. */
export function evalBudgetLine(budget: EvalBudgetView): string {
	const left = Math.max(0, budget.usd - budget.spent);
	return `Eval budget: ${dollars(budget.spent)} spent of ${dollars(budget.usd)}, ${dollars(left)} left. A round whose ceiling does not fit what is left waits for an eval budget card asking for more.`;
}

function dollars(amount: number): string {
	return `$${amount.toFixed(2)}`;
}
