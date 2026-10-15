import type { Decider } from "webappwiz/decide";
import type { Cleaned, Cleanup, DictationEdit } from "webappwiz/dictate";

/*
 * Runs the dictation cleanups over prompts a person already sent, on each
 * model, to pick a model and thresholds from real text rather than a handful
 * of fixtures. `compare-cleanups.ts` is the script that spends on it.
 */

/** The longest prompt kept; anything longer was pasted, not dictated. */
export const LONGEST_PROMPT = 2000;

/**
 * The prompts a person sent in Claude Code transcripts, one JSON object a
 * line, oldest file first and each once: what they typed or dictated, never
 * what a harness, a page token (`[ARBOR LANE 3]`), a command or a quoted
 * answer from the `arbor dev` page put there.
 */
export function sentPrompts(transcripts: string[]): string[] {
	const sent = new Set<string>();
	for (const transcript of transcripts) {
		for (const line of transcript.split("\n")) {
			const text = promptOf(line);
			if (text !== undefined) {
				sent.add(text);
			}
		}
	}
	return [...sent];
}

function promptOf(line: string): string | undefined {
	let entry: {
		type?: string;
		isMeta?: boolean;
		origin?: { kind?: string };
		message?: { content?: unknown };
	};
	try {
		entry = JSON.parse(line);
	} catch {
		return undefined;
	}
	const kind = entry.origin?.kind;
	if (
		entry.type !== "user" ||
		entry.isMeta === true ||
		(kind !== "sdk" && kind !== "human" && kind !== "typed")
	) {
		return undefined;
	}
	const content = entry.message?.content;
	const text = (
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.filter((block) => block?.type === "text")
						.map((block) => String(block.text ?? ""))
						.join("\n")
				: ""
	).trim();
	if (
		text === "" ||
		"[<>".includes(text[0] ?? "") ||
		text.length > LONGEST_PROMPT
	) {
		return undefined;
	}
	return text;
}

/** The cleanups to compare, by name, each deciding with `decider`. */
export type CleanupsFor = (decider: Decider) => Record<string, Cleanup>;

/** What one model made of one prompt with one cleanup. */
export type Outcome = Cleaned | { failed: string };

/** One prompt, and what each model made of it with one cleanup. */
export interface Compared {
	prompt: string;
	cleanup: string;
	/** By model. */
	outcomes: Record<string, Outcome>;
}

/**
 * Each cleanup of `cleanupsFor` on each prompt, on each model's decider, on
 * its own rather than in sequence, so a disagreement is that cleanup's.
 * `concurrency` prompts are in flight at once.
 */
export async function compareCleanups(
	prompts: string[],
	deciders: Record<string, Decider>,
	cleanupsFor: CleanupsFor,
	{
		concurrency = 8,
		progress,
	}: { concurrency?: number; progress?: (done: number) => void } = {},
): Promise<Compared[]> {
	const cleanups = Object.entries(deciders).map(
		([model, decider]) => [model, cleanupsFor(decider)] as const,
	);
	const names = Object.keys(cleanups[0]?.[1] ?? {});
	const results: Compared[][] = [];
	let next = 0;
	let done = 0;
	const worker = async () => {
		while (next < prompts.length) {
			const index = next++;
			const prompt = prompts[index] ?? "";
			results[index] = await Promise.all(
				names.map(async (cleanup) => ({
					prompt,
					cleanup,
					outcomes: Object.fromEntries(
						await Promise.all(
							cleanups.map(
								async ([model, each]) =>
									[model, await outcome(each[cleanup], prompt)] as const,
							),
						),
					),
				})),
			);
			progress?.(++done);
		}
	};
	await Promise.all(Array.from({ length: concurrency }, worker));
	return results.flat();
}

async function outcome(
	cleanup: Cleanup | undefined,
	prompt: string,
): Promise<Outcome> {
	try {
		return (await cleanup?.clean(prompt)) ?? { text: prompt, edits: [] };
	} catch (error) {
		return { failed: String(error) };
	}
}

/** What the comparison found, for one cleanup. */
export interface CleanupSummary {
	cleanup: string;
	/** Prompts it changed or left an edit on, on any model. */
	touched: number;
	/** Prompts whose text the models made differently. */
	disagreed: Compared[];
	/** By model: edits left in the middle band, for the person to judge. */
	unsure: Record<string, number>;
	/** By model: prompts it changed. */
	changed: Record<string, number>;
	/** By model: prompts it failed on. */
	failed: Record<string, number>;
}

/** `compared`, one summary per cleanup, in the order they first appear. */
export function summarize(compared: Compared[]): CleanupSummary[] {
	const summaries = new Map<string, CleanupSummary>();
	for (const each of compared) {
		const summary = summaries.get(each.cleanup) ?? {
			cleanup: each.cleanup,
			touched: 0,
			disagreed: [],
			unsure: {},
			changed: {},
			failed: {},
		};
		summaries.set(each.cleanup, summary);
		const texts = new Set<string>();
		let touched = false;
		for (const [model, result] of Object.entries(each.outcomes)) {
			summary.unsure[model] ??= 0;
			summary.changed[model] ??= 0;
			summary.failed[model] ??= 0;
			if ("failed" in result) {
				summary.failed[model]++;
				continue;
			}
			texts.add(result.text);
			summary.unsure[model] += result.edits.length;
			if (result.text !== each.prompt) {
				summary.changed[model]++;
			}
			touched ||= result.text !== each.prompt || result.edits.length > 0;
		}
		if (touched) {
			summary.touched++;
		}
		if (texts.size > 1) {
			summary.disagreed.push(each);
		}
	}
	return [...summaries.values()];
}

/** An edit, as one line of a report. */
export function describeEdit(text: string, edit: DictationEdit): string {
	const span = JSON.stringify(text.slice(edit.start, edit.end));
	const sure = edit.probability.toFixed(2);
	switch (edit.type) {
		case "tag":
			return `tag ${span} as #${edit.system} (${sure})`;
		case "item":
			return `split ${span} into a list item (${sure})`;
		default:
			return `${edit.type} ${span} (${sure})`;
	}
}
