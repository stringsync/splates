import type { Document } from "../storage";
import {
	REPEAT_THRESHOLD,
	RULE_TASK_PREFIX,
	repeatedCorrections,
	ruleTaskText,
} from "./repeats";
import type { TrustStore } from "./store";
import type {
	RuleCorrection,
	RuleSuggestionView,
	TrustDecision,
} from "./types";

/** Project storage document key holding suggested repeat keys and task ids. */
export const RULE_SUGGESTIONS_DOC = "trust-rule-suggestions.json";

/** Where a suggestion goes: a project's board, adding to its Backlog. */
export interface SuggestionBoard {
	add(
		subject: string,
		from: string | null,
		opts: { text: string },
	): Promise<{ id: number }>;
}

/** Stored record of which repeats were suggested and which board task each created. */
export interface SuggestedFile {
	/** Each repeat's key, once suggested: never suggested again. */
	keys: string[];
	/** Board task id created for each repeat key, when recorded. */
	tasks?: Record<string, number>;
}

/** Minimal board task shape needed to list pending rule suggestions. */
export interface PendingBoardTask {
	id: number;
	subject: string;
	createdAt: string;
	stage: string;
	takenBy: string | null;
}

/**
 * Suggests writing down a project rule for each new repeat among a project's
 * overturned picks, as a Backlog task the user queues to have an agent
 * propose it, or removes to dismiss it. Each repeat is suggested once.
 */
export class RuleSuggestions {
	constructor(
		private readonly trust: TrustStore,
		private readonly board: SuggestionBoard,
		private readonly suggested: Document<SuggestedFile>,
		private readonly threshold = REPEAT_THRESHOLD,
	) {}

	/** Adds a task for each repeat in `project` not yet suggested; their ids. */
	async suggest(project: string, from: string | null): Promise<number[]> {
		if (project === "") {
			return [];
		}
		const decisions = await this.trust.decisions({ project });
		const repeats = repeatedCorrections(decisions, {
			threshold: this.threshold,
		});
		const done = new Set((await this.suggested.read())?.keys ?? []);
		const fresh = repeats.filter((each) => !done.has(each.key));
		if (fresh.length === 0) {
			return [];
		}
		// Kept before adding, so a failing add never suggests one twice.
		await this.suggested.update((current) => ({
			keys: [
				...new Set([
					...(current?.keys ?? []),
					...fresh.map((each) => each.key),
				]),
			],
			...(current?.tasks === undefined ? {} : { tasks: current.tasks }),
		}));
		const added: number[] = [];
		const linked: Record<string, number> = {};
		for (const repeat of fresh) {
			const { subject, text } = ruleTaskText(repeat);
			const id = (await this.board.add(subject, from, { text })).id;
			added.push(id);
			linked[repeat.key] = id;
		}
		await this.suggested.update((current) => ({
			keys: current?.keys ?? fresh.map((each) => each.key),
			tasks: { ...(current?.tasks ?? {}), ...linked },
		}));
		return added;
	}
}

/**
 * Pairs a project's still-pending Backlog rule suggestion tasks with the
 * repeated corrections that prompted each one, newest task first.
 */
export function pendingRuleSuggestions({
	project,
	slug,
	decisions,
	tasks,
	recorded,
	threshold = REPEAT_THRESHOLD,
}: {
	project: string;
	slug: string;
	decisions: readonly TrustDecision[];
	tasks: readonly PendingBoardTask[];
	recorded: SuggestedFile | null;
	threshold?: number;
}): RuleSuggestionView[] {
	const repeats = repeatedCorrections(decisions, { threshold });
	const byKey = new Map(repeats.map((each) => [each.key, each]));
	const bySubject = new Map(
		repeats.map((each) => [ruleTaskText(each).subject, each]),
	);
	const keyByTask = new Map<number, string>();
	for (const [key, taskId] of Object.entries(recorded?.tasks ?? {})) {
		keyByTask.set(taskId, key);
	}
	const views: RuleSuggestionView[] = [];
	for (const task of tasks) {
		if (task.stage !== "available" || task.takenBy !== null) {
			continue;
		}
		const recordedKey = keyByTask.get(task.id);
		const repeat =
			recordedKey !== undefined
				? byKey.get(recordedKey)
				: task.subject.startsWith(RULE_TASK_PREFIX)
					? bySubject.get(task.subject)
					: undefined;
		if (
			recordedKey === undefined &&
			!task.subject.startsWith(RULE_TASK_PREFIX)
		) {
			continue;
		}
		views.push({
			project,
			slug,
			taskId: task.id,
			subject: task.subject,
			createdAt: task.createdAt,
			corrections: (repeat?.decisions ?? []).map(correctionOf),
		});
	}
	return views.sort(
		(left, right) =>
			right.createdAt.localeCompare(left.createdAt) ||
			right.taskId - left.taskId,
	);
}

function correctionOf(decision: TrustDecision): RuleCorrection {
	return {
		id: decision.id,
		at: decision.at,
		subject: decision.subject,
		...(decision.picked === undefined ? {} : { picked: decision.picked }),
		...(decision.instead === undefined ? {} : { instead: decision.instead }),
		agent: decision.agent,
		model: decision.model,
		task: decision.task,
		conversation: decision.conversation,
	};
}
