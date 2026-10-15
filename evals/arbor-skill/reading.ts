import { arborCalls, type Beat } from "@webappwiz/arbor/skill-checks";

// What the checks read off a run: its turns and words, the arbor commands it
// ran, and the questions its ARBOR.md asks.

/** A question under `## Blocked` not yet checked off: its subject and its choices as written. */
export interface Question {
	subject: string;
	choices: string[];
}

/** The open questions in an ARBOR.md. */
export function openQuestions(plan: string): Question[] {
	const found: Question[] = [];
	let open = false;
	for (const line of section(plan, "Blocked").split("\n")) {
		const question = /^- \[( |x)\] \d+\. (.+)$/.exec(line);
		if (question !== null) {
			open = question[1] === " ";
			if (open) {
				found.push({ subject: (question[2] as string).trim(), choices: [] });
			}
			continue;
		}
		const choice = /^\s+- \(\w\) (.+)$/.exec(line);
		if (open && choice !== null) {
			found.at(-1)?.choices.push((choice[1] as string).trim());
		}
	}
	return found;
}

/** The text under `## <heading>` in an ARBOR.md, up to the next `##`. */
export function section(plan: string, heading: string): string {
	const lines = plan.split("\n");
	const from = lines.findIndex((line) => line.trim() === `## ${heading}`);
	if (from === -1) {
		return "";
	}
	const to = lines.findIndex((line, at) => at > from && /^## /.test(line));
	return lines.slice(from + 1, to === -1 ? undefined : to).join("\n");
}

/** Each `arbor` command the agent ran, by verb and words, with where it ran in the beats; asking for help does not count. */
export function arborRuns(
	beats: Beat[],
): { at: number; verb: string; args: string[]; output: string }[] {
	return beats.flatMap((beat, at) =>
		beat.kind === "run"
			? arborCalls(beat.command)
					.filter(
						(call) =>
							!call.args.some((arg) => arg === "--help" || arg === "-h"),
					)
					.map((call) => ({ ...call, at, output: beat.output }))
			: [],
	);
}

/** The beats split into turns, each starting at its `user` beat. */
export function turnsOf(beats: Beat[]): Beat[][] {
	const turns: Beat[][] = [];
	for (const beat of beats) {
		if (beat.kind === "user" || turns.length === 0) {
			turns.push([]);
		}
		turns.at(-1)?.push(beat);
	}
	return turns;
}

/** The last words in `beats`; empty when they say none. */
export function lastSaid(beats: Beat[]): string {
	const last = beats.findLast((beat) => beat.kind === "say");
	return last?.kind === "say" ? last.text.trim() : "";
}
