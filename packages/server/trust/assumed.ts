import { DECISION_KINDS, type DecisionKind } from "./types";

/** What the user reads for each decision kind, as the Trust page names them. */
export const KIND_LABELS: Record<DecisionKind, string> = {
	defaults: "Defaults",
	design: "API / design",
	scope: "Scope / split",
	visual: "Visual / UI",
	approval: "Approval",
};

/** One `🛡 Assumed:` line an agent wrote, as parsed from its reply. */
export interface AssumedLine {
	/** What the agent went with, `Retry limit: 3`. */
	assumed: string;
	/** What it would have been otherwise, `5`. */
	alternative: string;
	kind: DecisionKind;
}

/**
 * `🛡 Assumed: Retry limit: 3 (vs 5 · defaults)` at the start of a line: the
 * pick, then in the last parentheses the alternative and the decision kind.
 * The shield is optional, so a line typed without it still counts.
 */
const ASSUMED_LINE =
	/^[ \t]*(?:[-*>][ \t]+)?(?:🛡️?[ \t]*)?\*{0,2}Assumed:\*{0,2}[ \t]+(.+?)[ \t]+\((?:vs\.?|instead of)[ \t]+(.+?)[ \t]+[·|,;][ \t]+([^()]+?)\)[ \t]*$/i;

/** The kind `text` names, by id (`defaults`) or label (`API / design`), or null. */
export function kindNamed(text: string): DecisionKind | null {
	const wanted = text.trim().toLowerCase();
	for (const kind of DECISION_KINDS) {
		if (wanted === kind) {
			return kind;
		}
		const label = KIND_LABELS[kind].toLowerCase();
		if (
			wanted === label ||
			label.split(" / ").some((part) => part.trim() === wanted)
		) {
			return kind;
		}
	}
	return null;
}

/** Parses one line as an Assumed line, or null when it is not one. */
export function parseAssumedLine(line: string): AssumedLine | null {
	const match = ASSUMED_LINE.exec(line);
	if (match === null) {
		return null;
	}
	const [, assumed, alternative, kindText] = match;
	const kind = kindNamed(kindText ?? "");
	if (kind === null || assumed === undefined || alternative === undefined) {
		return null;
	}
	return {
		assumed: assumed.trim().replace(/^`(.*)`$/, "$1"),
		alternative: alternative.trim().replace(/^`(.*)`$/, "$1"),
		kind,
	};
}

/** Every Assumed line in `text`, in order, outside fenced code blocks. */
export function assumedLines(text: string): AssumedLine[] {
	const found: AssumedLine[] = [];
	let fenced = false;
	for (const line of text.split("\n")) {
		if (/^[ \t]*(```|~~~)/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) {
			continue;
		}
		const parsed = parseAssumedLine(line);
		if (parsed !== null) {
			found.push(parsed);
		}
	}
	return found;
}

/** Writes `line` back in the shape agents write it. */
export function formatAssumedLine(line: AssumedLine): string {
	return `🛡 Assumed: ${line.assumed} (vs ${line.alternative} · ${line.kind})`;
}

/**
 * `[SPLATES OVERTURN <n>]`, the reply that overturns the conversation's n-th
 * assumption, counting from 1; anything after it on the line says what the
 * user wants instead.
 */
const OVERTURN = /\[SPLATES OVERTURN (\d+)\][ \t]*([^\n]*)/g;

/** The overturns a user message carries, by assumption number. */
export function overturnsIn(text: string): { number: number; words: string }[] {
	return [...text.matchAll(OVERTURN)].map((match) => ({
		number: Number(match[1]),
		words: (match[2] ?? "").trim(),
	}));
}

/** The directive that overturns assumption `number`, `[SPLATES OVERTURN 2] Retry limit: 3 → 5`. */
export function overturnMessage(
	number: number,
	assumed: string,
	alternative: string,
): string {
	return `[SPLATES OVERTURN ${number}] ${assumed} → ${alternative}`;
}
