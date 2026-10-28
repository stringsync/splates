import type { BoardContext } from "./board";
import { earlyWarningOf, warningLines } from "./early-warning";
import { evalsDoneLine, evalsDoneOf } from "./evals-done";
import { queueStartOf, startLine } from "./queue-start";
import type { Named, SplatesEventView, Words } from "./splates-event";

type ServerBoard = Pick<BoardContext, "lanes" | "todos">;

/** The event lines splates server's words to an agent draw in their place. */
export function serverToldLines(
	text: string,
	board: ServerBoard,
	at: string | null,
): SplatesEventView[] {
	const warning = earlyWarningOf(text);
	if (warning !== null) {
		return warningLines(warning, at, text);
	}
	const done = evalsDoneOf(text);
	if (done !== null) {
		return [evalsDoneLine(done, at, text)];
	}
	const start = queueStartOf(text);
	if (start !== null) {
		return [startLine(start, board.lanes, at, text)];
	}
	if (handOffOf(text) !== null) {
		return [handOffLine("Restarted", handOffOf(text) ?? "", at, text)];
	}
	const automation = AUTOMATION.exec(text);
	if (automation !== null) {
		return [
			view(
				["Automation", { kind: "automation", name: automation[1] ?? "" }],
				at,
				text,
			),
		];
	}
	const schedule = SCHEDULE.exec(text);
	if (schedule !== null) {
		return [
			view(
				[
					"Scheduled run",
					{
						kind: "automation",
						name: `automation ${schedule[1] ?? ""}`,
						scheduled: true,
					},
				],
				at,
				text,
			),
		];
	}
	const groom = GROOM.exec(text);
	if (groom !== null) {
		const id = Number(groom[1]);
		return [
			view(
				[
					"Groom",
					{
						kind: "todo",
						id,
						subject: board.todos.find((todo) => todo.id === id)?.subject ?? "",
					},
				],
				at,
				text,
			),
		];
	}
	const sort = SORT.exec(text);
	if (sort !== null) {
		const todos = (sort[1] ?? "").split(" ").map((each) => {
			const id = Number(each.slice(1));
			return {
				id,
				subject: board.todos.find((todo) => todo.id === id)?.subject ?? "",
			};
		});
		const [only] = todos;
		const named: Named =
			only !== undefined && todos.length === 1
				? { kind: "todo", ...only }
				: { kind: "todos", todos };
		return [view(["Sort", named], at, text)];
	}
	const task = TASK.exec(text);
	if (task !== null) {
		return [view(["Started", { kind: "task", task: task[1] ?? "" }], at, text)];
	}
	return [view([`Told agent: ${excerpt(text)}`], at, text)];
}

const EXCERPT_LENGTH = 80;

/** The prompt's first line, cut short, so a line for a prompt the page does not know says what it was. */
function excerpt(text: string): string {
	const first = text.trim().split("\n")[0]?.trim() ?? "";
	return first.length > EXCERPT_LENGTH
		? `${first.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
		: first;
}

/** The line a server-generated handoff prompt draws, or null for another message. */
export function handOffLines(
	text: string,
	at: string | null,
): SplatesEventView[] | null {
	const task = handOffOf(text);
	return task === null ? null : [handOffLine("Handoff", task, at, text)];
}

/** The task a restart or handoff prompt continues, or null for another message. */
export function handOffOf(text: string): string | null {
	return HAND_OFF.exec(text)?.[1] ?? null;
}

function handOffLine(
	verb: string,
	task: string,
	at: string | null,
	title: string,
): SplatesEventView {
	return view([verb, { kind: "task", task }], at, title);
}

function view(
	words: Words,
	at: string | null,
	title: string,
): SplatesEventView {
	return { words, at, title };
}

const HAND_OFF =
	/^\[SPLATES TASK (\S+)\]\n\nThe agent before you on this task stopped without handing it over, so its SPLATES\.md may be behind\./u;
const AUTOMATION = /^\[SPLATES EVENT ([^\]\n]+)\]/u;
const SCHEDULE = /^\[SPLATES SCHEDULE ([^\]\n]+)\]/u;
const GROOM = /^\[SPLATES GROOM #(\d+)\]\s*$/u;
const SORT = /^\[SPLATES SORT ((?:#\d+)(?: #\d+)*)\]\s*$/u;
const TASK = /^\[SPLATES TASK ([^\]\s]+)\]/u;
