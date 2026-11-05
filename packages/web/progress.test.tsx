import { describe, expect, it } from "bun:test";
import type { Progress } from "@splates/server/conversations";
import { backgrounded, ProgressCard } from "./progress";
import { fireEvent, render } from "./testing-library";

const card = (overrides: Partial<Progress> = {}): Progress => ({
	id: "build",
	title: "Import fixtures",
	state: "running",
	percent: 40,
	note: "parsing score-05",
	startedAt: "2026-11-04T10:00:00Z",
	updatedAt: "2026-11-04T10:01:00Z",
	history: [{ at: "2026-11-04T10:00:30Z", note: "parsing score-04" }],
	...overrides,
});

describe("backgrounded", () => {
	it("is true while a progress card runs, with no background command", () => {
		expect(backgrounded({ background: [], progress: [card()] })).toBe(true);
	});

	it("is false once every card has finished, failed or stopped", () => {
		const progress = (["done", "failed", "stopped"] as const).map((state) =>
			card({ id: state, state }),
		);

		expect(backgrounded({ background: [], progress })).toBe(false);
	});

	it("is true for a running background command with no card", () => {
		expect(
			backgrounded({
				background: [
					{
						id: "b1",
						name: "tests",
						command: null,
						subagent: null,
						state: "running",
						output: null,
					},
				],
				progress: [],
			}),
		).toBe(true);
	});
});

describe("ProgressCard", () => {
	it("is absent while nothing has been reported", () => {
		const { container } = render(<ProgressCard progress={[]} />);

		expect(container.textContent).toBe("");
	});

	it("shows the title, percent and latest note, history behind a click", () => {
		const page = render(<ProgressCard progress={[card()]} />);

		expect(page.container.textContent).toContain("Import fixtures");
		expect(page.container.textContent).toContain("40%");
		expect(page.container.textContent).toContain("parsing score-05");
		expect(page.container.textContent).not.toContain("parsing score-04");
		expect(page.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
			"40",
		);

		fireEvent.click(page.getByRole("button", { name: /Import fixtures/ }));

		expect(page.container.textContent).toContain("parsing score-04");
	});

	it("shows the newest three, the rest behind a row", () => {
		const cards = ["one", "two", "three", "four"].map((id) =>
			card({ id, title: `task ${id}`, history: [] }),
		);
		const page = render(<ProgressCard progress={cards} />);

		expect(page.queryByText("task one")).toBeNull();
		expect(page.queryByText("task four")).not.toBeNull();

		fireEvent.click(page.getByRole("button", { name: "Show 1 more" }));

		expect(page.queryByText("task one")).not.toBeNull();
	});
});
