import { afterEach, describe, expect, it } from "bun:test";
import { AgentWaitBarView } from "./agent-wait-bar";
import { Board, NO_BOARD } from "./board";
import { cleanup, fireEvent, render } from "./testing-library";

describe("agent wait bar", () => {
	afterEach(cleanup);

	it("says in one row which task it waits for, and opens it from View", () => {
		const opened: string[] = [];
		const view = render(
			<Board
				value={{
					...NO_BOARD,
					linked: true,
					tasks: ["desktop-card-pager"],
					openTask: (task: string) => opened.push(task),
				}}
			>
				<AgentWaitBarView
					wait={{ type: "task", task: "desktop-card-pager" }}
					at={new Date(Date.now() - 36 * 60_000).toISOString()}
				/>
			</Board>,
		);
		expect(view.getByText("Waiting for")).toBeTruthy();
		expect(view.getByText("desktop-card-pager")).toBeTruthy();
		expect(view.getByText("to finish")).toBeTruthy();
		expect(view.getByText("36m so far")).toBeTruthy();
		expect(view.queryByText("Waiting")).toBeNull();
		fireEvent.click(
			view.getByRole("button", { name: "View task desktop-card-pager" }),
		);
		expect(opened).toEqual(["desktop-card-pager"]);
	});

	it("says what an idle wait needs, with nothing to view", () => {
		const view = render(
			<AgentWaitBarView wait={{ type: "idle", duration: "2m" }} at={null} />,
		);
		expect(view.getByText("the machine to stay idle 2m")).toBeTruthy();
		expect(view.queryByRole("button")).toBeNull();
	});
});
