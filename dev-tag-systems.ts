import { basename } from "node:path";
import type { Decider, Question } from "webappwiz/decide";
import type { Cleaned, Cleanup, DictationEdit } from "webappwiz/dictate";
import type { Project } from "./dev-project";
import { readSystems, type System } from "./systems";

/**
 * How sure a tag must be to go in the text (`apply`), and below which it is
 * dropped (`leave`). One in between goes back as an edit for the person to
 * judge.
 */
export const TAG_THRESHOLDS = { apply: 0.8, leave: 0.2 } as const;

/** A span of the text that may name one of `systems`. */
export interface Candidate {
	start: number;
	end: number;
	phrase: string;
	systems: string[];
	/** Letters it differs from the nearest name or alias by; 0 when exact. */
	distance: number;
}

/** The answer kept for a choice no system fits. */
const NONE = "none";

/** How many words of context a span's Choice shows on each side. */
const CONTEXT_WORDS = 6;

/**
 * The spans of `text` that say a system's name or alias, as heard or as a
 * speech model may have misheard it: the same letters, run together or
 * apart, or a letter or two off on a longer word. They never overlap; where
 * two would, the closer match wins, then the longer.
 */
export function candidates(
	text: string,
	systems: Record<string, System>,
): Candidate[] {
	const terms = Object.entries(systems).flatMap(([name, system]) =>
		[name, ...(system.aliases ?? [])].map((term) => ({
			name,
			letters: letters(term),
			words: term.split(/\s+/).length,
		})),
	);
	const words = wordsOf(text);
	const longest = Math.min(
		4,
		Math.max(0, ...terms.map((term) => term.words)) + 1,
	);
	const found: Candidate[] = [];
	for (let first = 0; first < words.length; first++) {
		for (
			let last = first;
			last < Math.min(words.length, first + longest);
			last++
		) {
			const span = words.slice(first, last + 1);
			const heard = letters(span.map((word) => word.text).join(""));
			let distance = Number.POSITIVE_INFINITY;
			let names: string[] = [];
			for (const term of terms) {
				const off = levenshtein(heard, term.letters);
				// Heard apart, a name must keep every letter, or "I cry" is scry.
				const limit = span.length > term.words ? 0 : allowed(term.letters);
				if (off > limit || off > distance) {
					continue;
				}
				if (off < distance) {
					distance = off;
					names = [];
				}
				if (!names.includes(term.name)) {
					names.push(term.name);
				}
			}
			if (names.length === 0) {
				continue;
			}
			const start = span[0]?.start ?? 0;
			const end = span.at(-1)?.end ?? start;
			found.push({
				start,
				end,
				phrase: text.slice(start, end),
				systems: names,
				distance,
			});
		}
	}
	found.sort(
		(one, other) =>
			one.distance - other.distance ||
			other.end - other.start - (one.end - one.start) ||
			one.start - other.start,
	);
	const kept: Candidate[] = [];
	for (const candidate of found) {
		if (
			kept.every(
				(other) => candidate.end <= other.start || candidate.start >= other.end,
			)
		) {
			kept.push(candidate);
		}
	}
	return kept.sort((one, other) => one.start - other.start);
}

/**
 * One Noul per system a candidate may name, on whether the speaker means
 * that part of the code at all, and one Choice per candidate, on which
 * system it names, if any.
 */
function questions(
	project: string,
	text: string,
	systems: Record<string, System>,
	found: Candidate[],
): Record<string, Question> {
	const asked: Record<string, Question> = {};
	for (const name of new Set(found.flatMap((each) => each.systems))) {
		const system = systems[name];
		if (system === undefined) {
			continue;
		}
		const said = [name, ...(system.aliases ?? [])]
			.map((term) => `"${term}"`)
			.join(" or ");
		asked[`refers.${name}`] = {
			type: "noul",
			instructions: `Does the speaker refer to ${describe(project, name, system)}?`,
			criteria: {
				true: `They mean that part of the code, by ${said} or a mishearing of it.`,
				false: `They use ${said} as an everyday word, or for something other than that part of the code.`,
			},
		};
	}
	found.forEach((candidate, index) => {
		const criteria: Record<string, unknown> = {};
		for (const name of candidate.systems) {
			const system = systems[name];
			if (system !== undefined) {
				criteria[name] = describe(project, name, system);
			}
		}
		criteria[NONE] =
			"No part of the code: an everyday word, or a name for something else.";
		asked[`span.${index}`] = {
			type: "choice",
			instructions: {
				question:
					"Which part of the code does the speaker name with the phrase in brackets, if any?",
				phrase: candidate.phrase,
				where: around(text, candidate),
			},
			criteria,
		};
	});
	return asked;
}

/**
 * Tags the systems `text` names as `#name`: code finds the spans that may
 * name one, `decider` judges them all in one request, and each span becomes
 * `#name` when the system's Noul and the span's Choice together are sure
 * enough, as {@link TAG_THRESHOLDS} says.
 */
export async function tagSystems(
	decider: Decider,
	project: string,
	systems: Record<string, System>,
	text: string,
	signal?: AbortSignal,
): Promise<Cleaned> {
	const found = candidates(text, systems);
	if (found.length === 0) {
		return { text, edits: [] };
	}
	const { answers } = await decider.decide(
		text,
		questions(project, text, systems, found),
		signal,
	);
	let tagged = "";
	let from = 0;
	const edits: DictationEdit[] = [];
	found.forEach((candidate, index) => {
		const choice = answers[`span.${index}`];
		if (choice?.type !== "choice") {
			return;
		}
		let best: { system: string; probability: number } | undefined;
		for (const system of candidate.systems) {
			const refers = answers[`refers.${system}`];
			const probability =
				(choice.probabilities[system] ?? 0) *
				(refers?.type === "noul" ? refers.noul : 0);
			if (best === undefined || probability > best.probability) {
				best = { system, probability };
			}
		}
		if (best === undefined || best.probability < TAG_THRESHOLDS.leave) {
			return;
		}
		tagged += text.slice(from, candidate.start);
		from = candidate.start;
		if (best.probability > TAG_THRESHOLDS.apply) {
			tagged += `#${best.system}`;
			from = candidate.end;
			return;
		}
		const start = tagged.length;
		edits.push({
			type: "tag",
			start,
			end: start + candidate.end - candidate.start,
			system: best.system,
			probability: best.probability,
		});
	});
	return { text: tagged + text.slice(from), edits };
}

/**
 * The cleanup that tags the systems `project`'s `arbor.systems.ts` names,
 * read afresh for each take, deciding with `decider`.
 */
export class SystemTagger implements Cleanup {
	constructor(
		private readonly project: Project,
		private readonly decider: Decider,
	) {}

	async clean(text: string): Promise<Cleaned> {
		const root = this.project.service.git.root;
		const systems = await readSystems(root, this.project.fs);
		return tagSystems(this.decider, basename(root), systems, text);
	}
}

/** How many letters `from` must change by to become `to`. */
function levenshtein(from: string, to: string): number {
	let row = Array.from({ length: to.length + 1 }, (_, i) => i);
	for (let i = 1; i <= from.length; i++) {
		const next = [i];
		for (let j = 1; j <= to.length; j++) {
			next[j] = Math.min(
				(row[j] ?? 0) + 1,
				(next[j - 1] ?? 0) + 1,
				(row[j - 1] ?? 0) + (from[i - 1] === to[j - 1] ? 0 : 1),
			);
		}
		row = next;
	}
	return row[to.length] ?? 0;
}

/** A word of the text, where it starts and ends, without a trailing `'s`. */
interface Word {
	text: string;
	start: number;
	end: number;
}

/**
 * The words of `text`, leaving out any already a mention, a path or a
 * command (`#scry`, `@file`, `/arbor`).
 */
function wordsOf(text: string): Word[] {
	const words: Word[] = [];
	for (const match of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)) {
		const before = text[match.index - 1];
		if (before === "#" || before === "@" || before === "/") {
			continue;
		}
		const word = match[0].replace(/['’]s$/i, "");
		words.push({
			text: word,
			start: match.index,
			end: match.index + word.length,
		});
	}
	return words;
}

/** `term`'s letters and digits, lowercased, so spacing and hyphens never count. */
function letters(term: string): string {
	return term.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** How many letters a heard span may be off by and still be `term` misheard. */
function allowed(term: string): number {
	return term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
}

/** What a system is, for a question about it. */
function describe(project: string, name: string, system: System): string {
	const aliases = system.aliases?.length
		? `, also called ${system.aliases.map((alias) => `"${alias}"`).join(" or ")}`
		: "";
	return `the "${name}" part of the ${project} codebase${aliases}, the code in ${system.globs.slice(0, 3).join(", ")}`;
}

/** A few words either side of `candidate`, with it in brackets. */
function around(text: string, candidate: Candidate): string {
	const before = text.slice(0, candidate.start).split(/\s+/);
	const after = text.slice(candidate.end).split(/\s+/);
	return `${before.slice(-CONTEXT_WORDS).join(" ")}[${candidate.phrase}]${after.slice(0, CONTEXT_WORDS).join(" ")}`;
}
