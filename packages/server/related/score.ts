import type { Candidate, Query } from "./candidates";

/** How much a word counts in each part of a task, its title most. */
const WEIGHTS = { title: 3, goal: 2, details: 0.5, files: 1 } as const;

type Field = keyof typeof WEIGHTS;

/** BM25's term saturation and length normalisation, at their usual values. */
const K1 = 1.2;
const LENGTH_NORM = 0.75;

/** A candidate and how well its words match the query's. */
export interface Scored {
	candidate: Candidate;
	score: number;
	/** How many of the query's words it has. */
	matched: number;
}

/**
 * The candidates most like `query` by the words they share, best first,
 * at most `limit` and only those sharing a word: BM25 over each candidate's
 * title, goal, details and file paths, each weighted as `WEIGHTS` says.
 * Status plays no part, so a merged task ranks beside a queued one.
 */
export function rank(query: Query, pool: Candidate[], limit: number): Scored[] {
	const docs = pool.map((candidate) => ({
		candidate,
		terms: termsOf(candidate),
	}));
	if (docs.length === 0) {
		return [];
	}
	const average =
		docs.reduce((sum, doc) => sum + doc.terms.length, 0) / docs.length || 1;
	const frequency = new Map<string, number>();
	for (const doc of docs) {
		for (const term of doc.terms.counts.keys()) {
			frequency.set(term, (frequency.get(term) ?? 0) + 1);
		}
	}
	const asked = termsOf(query).counts;
	return docs
		.map(({ candidate, terms }) => {
			let score = 0;
			let matched = 0;
			for (const [term, weight] of asked) {
				const tf = terms.counts.get(term);
				if (tf === undefined) {
					continue;
				}
				matched++;
				const df = frequency.get(term) ?? 0;
				const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
				const norm =
					K1 * (1 - LENGTH_NORM + (LENGTH_NORM * terms.length) / average);
				score += Math.min(weight, 1) * idf * ((tf * (K1 + 1)) / (tf + norm));
			}
			return { candidate, score, matched };
		})
		.filter((each) => each.matched > 0)
		.sort((one, two) => two.score - one.score)
		.slice(0, limit);
}

/** How many different words `query` says something with. */
export function distinctWords(query: Query): number {
	return termsOf(query).counts.size;
}

/** A task's words, each counted by the weight of the field it is in. */
function termsOf(task: Query): { counts: Map<string, number>; length: number } {
	const counts = new Map<string, number>();
	let length = 0;
	for (const field of Object.keys(WEIGHTS) as Field[]) {
		const text = field === "files" ? task.files.join(" ") : task[field];
		for (const word of words(text)) {
			counts.set(word, (counts.get(word) ?? 0) + WEIGHTS[field]);
			length += WEIGHTS[field];
		}
	}
	return { counts, length };
}

/** The words of `text` that `rank` compares, to see why two tasks matched. */
export function words(text: string): string[] {
	// Lowercase and singular, a path or a kebab or camel name in its parts,
	// common words and file-name noise left out.
	return text
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 1 && !STOP.has(word))
		.map(singular);
}

function singular(word: string): string {
	if (word.length > 4 && word.endsWith("ies")) {
		return `${word.slice(0, -3)}y`;
	}
	if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
		return word.slice(0, -1);
	}
	return word;
}

const STOP = new Set(
	(
		"a an and are as at be by can do does for from has have in into is it its no not of on " +
		"one or so than that the their them then there these they this to was we were what when " +
		"which who will with without would you your now only also just more most any all each " +
		"every same other ts tsx js md json packages package src index test tests"
	).split(" "),
);
