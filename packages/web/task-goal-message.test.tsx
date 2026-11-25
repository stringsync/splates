import { expect, test } from "bun:test";
import type { TaskRecord } from "@splates/server/board";
import { Board, NO_BOARD } from "./board";
import { QueueGoal } from "./task-goal-message";
import { render } from "./testing-library";

const START =
	"[SPLATES TASK signal-blockers]\n\nsplates server started this task for queued task #7 from the queue, which lane 2 queued: nothing it is blocked by is left open.";

function shown(text: string, todos: TaskRecord[]): string {
	const { container } = render(
		<Board.Provider value={{ ...NO_BOARD, todos }}>
			<QueueGoal text={text} />
		</Board.Provider>,
	);
	return container.textContent ?? "";
}

test("shows the queued task's goal as a message", () => {
	const todos = [
		{ id: 7, subject: "Make a signal its own kind of blocker", text: "" },
	] as TaskRecord[];
	const words = shown(START, todos);
	expect(words).toContain("#7");
	expect(words).not.toContain("Queued");
	expect(words).not.toContain("pick this up");
	expect(words).toContain("Make a signal its own kind of blocker");
});

test("shows nothing for other text or a task the board lacks", () => {
	expect(shown("hello", [])).toBe("");
	expect(shown(START, [])).toBe("");
});

test("leads with the goal without Before and After headings for legacy task text", () => {
	const todos = [
		{
			id: 7,
			subject: "Upload retries forever on a 413",
			text: "## Before\n\nUploads loop forever on a 413.\n\n## After\n\nAn upload stops retrying on a 413.",
		},
	] as TaskRecord[];
	const words = shown(START, todos);
	expect(words).toContain("An upload stops retrying on a 413.");
	expect(words).not.toContain("Before");
	expect(words).not.toContain("After");
	expect(words.indexOf("An upload stops retrying")).toBeLessThan(
		words.indexOf("Uploads loop forever"),
	);
});
