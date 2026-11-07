/** What kind of thing a timeline entry is. */
export type RecEntryKind =
	| "said"
	| "remark"
	| "route"
	| "pointer"
	| "console"
	| "network"
	| "server";

/** One row of a session's timeline, in video seconds. */
export interface RecTimelineEntry {
	at: number;
	kind: RecEntryKind;
	text: string;
	/** Where it came from, such as a log file name. */
	source?: string;
	error: boolean;
}

const TIMELINE_LINE = /^- (\d+):(\d+(?:\.\d+)?) (.*)$/;
const LOG_LINE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (\w+)\s+(.*)$/;

/** The entries of `timeline.md` (narration, remarks, routes, pointers), without its pointers to logs. */
export function timelineFileEntries(text: string): RecTimelineEntry[] {
	const out: RecTimelineEntry[] = [];
	for (const line of text.split("\n")) {
		const match = TIMELINE_LINE.exec(line);
		if (match === null) {
			continue;
		}
		const at = Number(match[1]) * 60 + Number(match[2]);
		const rest = match[3] ?? "";
		if (rest.startsWith("narration: ")) {
			out.push({
				at,
				kind: "said",
				text: rest.slice("narration: ".length),
				error: false,
			});
		} else if (rest.startsWith("remark: ")) {
			out.push({
				at,
				kind: "remark",
				text: rest.slice("remark: ".length),
				error: false,
			});
		} else if (rest.startsWith("pointer route changed to ")) {
			out.push({
				at,
				kind: "route",
				text: rest.slice("pointer route changed to ".length),
				error: false,
			});
		} else if (rest.startsWith("pointer ")) {
			out.push({
				at,
				kind: "pointer",
				text: rest.slice("pointer ".length),
				error: false,
			});
		}
	}
	return out;
}

/** The lines of a log file as entries; `startedAt` is wall-clock ms of video time zero. */
export function logEntries(
	file: string,
	text: string,
	startedAt: number,
): RecTimelineEntry[] {
	const kind: RecEntryKind = file.includes("console")
		? "console"
		: file.includes("network")
			? "network"
			: "server";
	const out: RecTimelineEntry[] = [];
	for (const line of text.split("\n")) {
		const match = LOG_LINE.exec(line);
		if (match === null) {
			continue;
		}
		const at = (Date.parse(match[1] ?? "") - startedAt) / 1000;
		if (Number.isNaN(at) || at < 0) {
			continue;
		}
		out.push({
			at,
			kind,
			text: match[3] ?? "",
			source: file,
			error: match[2] === "ERROR" || match[2] === "FATAL",
		});
	}
	return out;
}

/** Every entry in video time, a stable sort so same-instant rows keep their order. */
export function mergeEntries(
	...lists: RecTimelineEntry[][]
): RecTimelineEntry[] {
	return lists.flat().sort((left, right) => left.at - right.at);
}
