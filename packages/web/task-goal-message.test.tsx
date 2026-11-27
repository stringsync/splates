import { afterEach, expect, test } from "bun:test";
import type { TaskRecord } from "@splates/server/board";
import { Board, NO_BOARD } from "./board";
import { CLAMP, CUT_FADE } from "./clamped";
import { QueueGoal } from "./task-goal-message";
import { act, cleanup, fireEvent, render, within } from "./testing-library";

const START =
	"[SPLATES TASK signal-blockers]\n\nsplates server started this task for queued task #7 from the queue, which lane 2 queued: nothing it is blocked by is left open.";

afterEach(cleanup);

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

test("clamps overflowing task details and toggles open when clicking the card, while ignoring inner links", () => {
	const todos = [
		{
			id: 7,
			subject: "Clamp long task details",
			text: "See [the docs](https://example.com) and lots of follow-up detail.",
		},
	] as TaskRecord[];
	withLayout(320, 96, () => {
		const view = render(
			<Board.Provider value={{ ...NO_BOARD, todos }}>
				<QueueGoal text={START} />
			</Board.Provider>,
		);
		const card = view.getByRole("article", { name: "Task #7" });
		const button = within(card).getByRole("button", { name: "Show all" });
		const body = card.querySelector("[class*='max-h-24']") as HTMLElement;
		expect(body).not.toBeNull();
		expect(body.className).toContain(CLAMP);
		expect(body.className).toContain(CUT_FADE);
		expect(button.getAttribute("aria-expanded")).toBe("false");

		act(() =>
			fireEvent.click(within(card).getByRole("link", { name: "the docs" })),
		);
		expect(button.getAttribute("aria-expanded")).toBe("false");

		act(() =>
			fireEvent.click(within(card).getByText("Clamp long task details")),
		);
		expect(button.getAttribute("aria-expanded")).toBe("true");
		expect(button.getAttribute("aria-label")).toBe("Show less");
		expect(body.className).not.toContain(CLAMP);
		expect(body.className).not.toContain(CUT_FADE);

		act(() => fireEvent.click(button));
		expect(button.getAttribute("aria-expanded")).toBe("false");
		expect(body.className).toContain(CLAMP);
		expect(body.className).toContain(CUT_FADE);
	});
});

test("leaves short task details unclamped with no expand control", () => {
	const todos = [
		{
			id: 7,
			subject: "Short task",
			text: "One short line.",
		},
	] as TaskRecord[];
	withLayout(24, 24, () => {
		const view = render(
			<Board.Provider value={{ ...NO_BOARD, todos }}>
				<QueueGoal text={START} />
			</Board.Provider>,
		);
		const card = view.getByRole("article", { name: "Task #7" });
		expect(within(card).queryByRole("button")).toBeNull();
		expect(card.innerHTML).not.toContain(CUT_FADE);
	});
});

function shown(text: string, todos: TaskRecord[]): string {
	const { container } = render(
		<Board.Provider value={{ ...NO_BOARD, todos }}>
			<QueueGoal text={text} />
		</Board.Provider>,
	);
	return container.textContent ?? "";
}

function withLayout(
	scrollHeight: number,
	clientHeight: number,
	run: () => void,
): void {
	const previousScroll = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"scrollHeight",
	);
	const previousClient = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"clientHeight",
	);
	// vet-ignore no-monkeypatching: happy-dom has no layout engine, so scrollHeight is always 0
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
		configurable: true,
		get: () => scrollHeight,
	});
	// vet-ignore no-monkeypatching: happy-dom has no layout engine, so clientHeight is always 0
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => clientHeight,
	});
	try {
		run();
	} finally {
		Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
		Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
		// vet-ignore no-monkeypatching: restores HTMLElement.prototype layout properties after test
		Object.defineProperties(HTMLElement.prototype, {
			...(previousScroll ? { scrollHeight: previousScroll } : {}),
			...(previousClient ? { clientHeight: previousClient } : {}),
		});
	}
}
