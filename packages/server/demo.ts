/** A demo's heading, `### 🎬 Demo: <title>`, its title optional. */
const DEMO = /^### 🎬 Demo(?::[ \t]*(.*?))?[ \t]*$/;
/** A step of a demo, numbered at the margin: `2. Drag it to another lane.` */
const STEP = /^(\d+)\.[ \t]+(.+)$/;

/**
 * Something to try, as the skill writes it under `### 🎬 Demo: <title>`:
 * where, then numbered steps.
 */
export interface Demo {
	/** What it shows, from its heading; null when the heading says none. */
	title: string | null;
	/** Where to try it and anything said before the steps, as markdown. */
	intro: string;
	steps: Step[];
}

/** A step of a demo: what to do, on its line, and what to see, under it. */
export interface Step {
	number: string;
	action: string;
	/** What should happen, screenshots included, as markdown. */
	expect: string;
}

/**
 * The demo titled at `start`: what it says up to its steps, or to `until`,
 * where something else begins, then its steps, and the line after them; null
 * for any other line.
 */
export function demoAt(
	lines: string[],
	start: number,
	until: number,
): { demo: Demo; end: number } | null {
	const title = DEMO.exec(lines[start] as string);
	if (title === null) {
		return null;
	}
	const first = lines.findIndex(
		(line, at) => at > start && at < until && STEP.exec(line)?.[1] === "1",
	);
	const steps: Step[] = [];
	let end = first === -1 ? until : first;
	if (first !== -1) {
		let body: string[] = [];
		for (let i = first; i < lines.length; i += 1) {
			const line = lines[i] as string;
			const item = STEP.exec(line);
			if (item !== null && item[1] === String(steps.length + 1)) {
				body = [];
				steps.push({
					number: item[1],
					action: (item[2] ?? "").trim(),
					expect: "",
				});
				end = i + 1;
				continue;
			}
			if (line.trim() === "") {
				continue;
			}
			// Back at the margin, and not the next step: the steps are over.
			if (!/^[ \t]/.test(line)) {
				break;
			}
			body.push(...lines.slice(end, i).map(() => ""), line);
			(steps.at(-1) as Step).expect = dedented(body);
			end = i + 1;
		}
	}
	return {
		demo: {
			title: title[1] || null,
			intro: trimmed(lines.slice(start + 1, first === -1 ? until : first)),
			steps,
		},
		end,
	};
}

/** Whether `line` titles a demo. */
export function isDemoTitle(line: string): boolean {
	return DEMO.test(line);
}

/** `lines` without the indent they share, as markdown of their own. */
function dedented(lines: string[]): string {
	const indent = Math.min(
		...lines
			.filter((line) => line.trim() !== "")
			.map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0),
	);
	return trimmed(lines.map((line) => line.slice(indent)));
}

/** `lines` as one text, without blank lines at either end. */
function trimmed(lines: string[]): string {
	return lines.join("\n").replace(/^\n+|\s+$/g, "");
}
