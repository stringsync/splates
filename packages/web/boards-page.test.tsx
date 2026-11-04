import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { BoardsPage } from "./boards-page";
import { cleanup, fireEvent, render, snapshot, todo } from "./testing";

describe("BoardsPage", () => {
	afterEach(cleanup);

	it("pins the Queue, with how many it holds, and opens it", () => {
		const opened: string[] = [];
		const view = render(
			<BoardsPage
				snapshot={snapshot({
					todos: [
						todo({ id: 1, subject: "first", stage: "queued" }),
						todo({ id: 2, subject: "second", stage: "available" }),
					],
				})}
				onPick={() => {}}
				onQueue={() => opened.push("queue")}
			/>,
		);

		const entry = view.getByRole("button", { name: /Queue/ });
		expect(entry.textContent).toContain("1");
		fireEvent.click(entry);
		expect(opened).toEqual(["queue"]);
	});
});
