/** The layer an eval loop round changed, as the loop labels it. */
export const LAYERS = ["harness", "scenario", "judge", "skill"] as const;
export type Layer = (typeof LAYERS)[number];

/** A pass rate such as 2/3. */
export interface Rate {
	passed: number;
	of: number;
}

/** One row of an eval loop's `## Rounds` table. */
export interface Round {
	round: string;
	layer: Layer | null;
	change: string;
	current: Rate | null;
	baseline: Rate | null;
	/** Why it was changed, when the table has a Why column. */
	why: string;
	/** The files it touched, when the table has a Files column. */
	files: string;
}

/** An eval loop's rounds read out of a Done report, with the rest of its words. */
export interface EvalRounds {
	rounds: Round[];
	/** The report with the table and its `Stopped by:` line taken out. */
	rest: string;
	stoppedBy: string | null;
}

function cells(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/u, "")
		.replace(/\|$/u, "")
		.split("|")
		.map((cell) => cell.trim());
}

function rate(text: string): Rate | null {
	const found = /(\d+)\s*\/\s*(\d+)/u.exec(text);
	return found === null
		? null
		: { passed: Number(found[1]), of: Number(found[2]) };
}

function layer(text: string): Layer | null {
	const word = text.toLowerCase();
	return LAYERS.find((each) => each === word) ?? null;
}

/**
 * The rounds table of `text`, a Markdown table whose header names Round,
 * Label and Change (Current, Baseline, Why and Files are read when present),
 * or null when `text` holds none.
 */
export function evalRoundsOf(text: string): EvalRounds | null {
	const lines = text.split("\n");
	const head = lines.findIndex((line) => {
		const names = cells(line).map((cell) => cell.toLowerCase());
		return (
			line.includes("|") &&
			names.includes("round") &&
			names.includes("label") &&
			names.includes("change")
		);
	});
	if (head < 0) {
		return null;
	}
	const names = cells(lines[head] ?? "").map((cell) => cell.toLowerCase());
	const at = (name: string): number => names.indexOf(name);
	let end = head + 1;
	const rounds: Round[] = [];
	while (end < lines.length && (lines[end] ?? "").includes("|")) {
		const row = cells(lines[end] ?? "");
		if (!/^[-:\s|]+$/u.test(lines[end] ?? "")) {
			const get = (name: string): string => row[at(name)] ?? "";
			rounds.push({
				round: get("round"),
				layer: layer(get("label")),
				change: get("change"),
				current: rate(get("current")),
				baseline: rate(get("baseline")),
				why: get("why"),
				files: get("files"),
			});
		}
		end += 1;
	}
	if (rounds.length === 0) {
		return null;
	}
	const stop = lines.findIndex((line) => /^stopped by:/iu.test(line.trim()));
	const stoppedBy =
		stop < 0 ? null : (lines[stop] ?? "").replace(/^[^:]*:\s*/u, "").trim();
	const rest = lines
		.filter((_, index) => !(index >= head && index < end) && index !== stop)
		.join("\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
	return { rounds, rest, stoppedBy };
}

/** How many rounds changed each layer, "2 skill · 1 judge", empty for none. */
export function layerCounts(rounds: Round[]): string {
	return [...LAYERS]
		.reverse()
		.map(
			(each) =>
				[each, rounds.filter((one) => one.layer === each).length] as const,
		)
		.filter(([, count]) => count > 0)
		.map(([each, count]) => `${count} ${each}`)
		.join(" · ");
}
