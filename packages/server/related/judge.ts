import type { Judge, JudgeOptions, Noul } from "../auto-pick";
import type { Candidate, Query } from "./candidates";

/** What a judge said of one candidate, each the probability of yes. */
export interface Verdict {
	/** That it is about the same change, so the new task's agent should read it first. */
	related: number;
	/** That it already does, or plans to do, all the new task asks. */
	supersedes: number;
	/** That it changes the same thing in a way the new task works against. */
	conflicts: number;
}

/**
 * The most a goal is sent at: enough for a sentence or two, so one wordy
 * task cannot crowd the request.
 */
const GOAL_CHARS = 320;

/**
 * Asks `judge` whether each of `shortlist` is about the same change as
 * `query`, and whether it supersedes or conflicts with it: one verdict per
 * candidate, in order, with what the judgment cost when the judge knows.
 * Titles and goals are sent, never details.
 */
export async function judgeShortlist(
	judge: Judge,
	query: Query,
	shortlist: Candidate[],
	opts: JudgeOptions = {},
): Promise<{ verdicts: Verdict[]; dollars: number | null }> {
	if (shortlist.length === 0) {
		return { verdicts: [], dollars: null };
	}
	// Every question in one request, as TypeSafe's fan-out pattern has it:
	// they are answered in parallel, so more of them cost little time.
	const candidates = Object.fromEntries(
		shortlist.map((each, i) => [
			`c${i}`,
			{ status: each.status, title: each.title, goal: clip(each.goal) },
		]),
	);
	const questions: Record<string, Noul> = {};
	shortlist.forEach((_, i) => {
		const it = `\`candidates.c${i}\``;
		questions[`r${i}`] = {
			type: "noul",
			instructions: `Is ${it} about the same change as \`new_task\`, so an agent doing \`new_task\` should read it first?`,
			criteria: {
				true: "Both change the same behavior, command, screen or rule, or one builds on or undoes the other.",
				false: "They only share a project, an area of the code, or some words.",
			},
		};
		questions[`s${i}`] = {
			type: "noul",
			instructions: `Does ${it} already do, or plan to do, everything \`new_task\` asks, so \`new_task\` would add nothing once it lands?`,
		};
		questions[`x${i}`] = {
			type: "noul",
			instructions: `Does ${it} change the same thing as \`new_task\` in a different or opposite way, so both cannot land as written?`,
		};
	});
	const verdict = await judge.judge(
		{
			state: {
				new_task: { title: query.title, goal: clip(query.goal) },
				candidates,
			},
			questions,
		},
		opts,
	);
	const answer = (id: string) => verdict.answers.get(id) ?? 0;
	return {
		verdicts: shortlist.map((_, i) => ({
			related: answer(`r${i}`),
			supersedes: answer(`s${i}`),
			conflicts: answer(`x${i}`),
		})),
		dollars: verdict.dollars ?? null,
	};
}

function clip(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= GOAL_CHARS ? flat : `${flat.slice(0, GOAL_CHARS - 1)}…`;
}
