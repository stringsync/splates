import { dedent } from "./plan";

/**
 * Instructions the agent gives the person to follow by hand, titled
 * `## 📋 Steps: <title>`: what it says first, the steps of its numbered list,
 * and anything it says after them.
 */
export interface Steps {
	title: string;
	/** What it says before its first step, as markdown. */
	intro: string;
	/** Each step as markdown: its line, then what is indented under it. */
	steps: string[];
	/** What it says after its last step, as markdown. */
	outro: string;
}

const TITLE = /^## 📋️?[ \t]+Steps(?::[ \t]*(.*?))?[ \t]*$/;
const ITEM = /^(\d+)\.[ \t]+(.*)$/;
const FENCE = /^[ \t]*(```|~~~)/;

/** Whether `line` titles a Steps card. */
export function isStepsTitle(line: string): boolean {
	return TITLE.test(line);
}

/**
 * The Steps card titled by `lines[0]`, its body the rest of `lines`; null
 * when its body holds no numbered list.
 */
export function stepsOf(lines: string[]): Steps | null {
	const title = TITLE.exec(lines[0] ?? "")?.[1] ?? "";
	const body = lines.slice(1);
	const intro: string[] = [];
	const outro: string[] = [];
	const steps: string[][] = [];
	let fenced = false;
	let over = false;
	for (const line of body) {
		const opens = FENCE.test(line);
		const item = fenced || over ? null : ITEM.exec(line);
		if (item !== null && Number(item[1]) === steps.length + 1) {
			steps.push([item[2] as string]);
		} else if (steps.length === 0) {
			intro.push(line);
		} else if (!over && (fenced || line.trim() === "" || /^[ \t]/.test(line))) {
			(steps.at(-1) as string[]).push(line);
		} else {
			over = true;
			outro.push(line);
		}
		if (opens) {
			fenced = !fenced;
		}
	}
	if (steps.length === 0) {
		return null;
	}
	return {
		title,
		intro: dedent(intro),
		steps: steps.map(([first, ...rest]) => `${first}\n${dedent(rest)}`.trim()),
		outro: dedent(outro),
	};
}
