import { afterEach, describe, expect, it } from "bun:test";
import { Board, NO_BOARD } from "./board";
import { todo } from "./fixtures";
import { OwnQueueCard } from "./permission-card";
import { reasonOf } from "./queue-reason";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

describe("reasonOf", () => {
	it("splits the why-not line from the rest of a queue card's text", () => {
		expect(
			reasonOf(
				"Why not auto-queued: the Agents setting is Never.\n\nBoth stop retries.",
			),
		).toEqual({
			reason: "The Agents setting is Never.",
			rest: "Both stop retries.",
		});
	});

	it("leaves text with no why-not line whole", () => {
		expect(reasonOf("Just a note.")).toEqual({
			reason: null,
			rest: "Just a note.",
		});
	});
});

it("draws a queue card's why-not line as a notice and not again in its text", () => {
	const first = todo({ id: 1, subject: "First task" });
	const { getByLabelText, container } = render(
		<Board.Provider value={{ ...NO_BOARD, linked: true, todos: [first] }}>
			<OwnQueueCard
				proposal={{
					action: "queue",
					lane: null,
					tasks: [1],
					title: "tasks added in this conversation",
					body: "Why not auto-queued: the engraving skill leaves queueing its tasks to you.\n\nThey run in order.",
				}}
			/>
		</Board.Provider>,
	);
	expect(getByLabelText("why not auto-queued").textContent).toContain(
		"The engraving skill leaves queueing its tasks to you.",
	);
	expect(container.textContent).not.toContain("Why not auto-queued:");
	expect(container.textContent).toContain("They run in order.");
});
