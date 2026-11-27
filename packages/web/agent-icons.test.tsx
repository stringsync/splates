import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { switched } from "@splates/server/conversations/browser";
import { RowIcon } from "./agent-icons";
import { ItemIcon } from "./conversation-item";
import { Row } from "./phone-inbox-row";
import { cleanup, conversation, render } from "./testing";

afterEach(cleanup);

describe("inbox agent marks", () => {
	it("uses the same branded colors as the composer", () => {
		const view = render(
			<RowIcon
				conversation={conversation({ agent: "claude" })}
				name="Claude"
			/>,
		);

		expect(view.getByRole("img", { name: "Claude" })).toBeTruthy();
		expect(view.container.querySelector('path[fill="#D97757"]')).toBeTruthy();
	});

	it("uses the hybrid mark while Autopick is on", () => {
		const state = conversation({ agent: "claude" });
		const view = render(
			<RowIcon
				conversation={{ ...state, autoPick: switched(state, true) }}
				name="Claude"
			/>,
		);

		expect(view.container.querySelector("clipPath")).toBeTruthy();
		expect(view.container.querySelector('path[fill="#D97757"]')).toBeTruthy();
	});

	it("uses the regular mark once Autopick is off", () => {
		const state = conversation({ agent: "claude" });
		const picked = { ...state, autoPick: switched(state, true) };
		const view = render(
			<RowIcon
				conversation={{ ...picked, autoPick: switched(picked, false) }}
				name="Claude"
			/>,
		);

		expect(view.container.querySelector("clipPath")).toBeNull();
		expect(view.getByRole("img", { name: "Claude" })).toBeTruthy();
	});

	it("marks a ship's task with a ship, even while Autopick is on", () => {
		const state = conversation({ agent: "claude", ship: "ship-1" });
		const view = render(
			<RowIcon
				conversation={{ ...state, autoPick: switched(state, true) }}
				name="Claude"
			/>,
		);

		expect(view.getByRole("img", { name: "Claude" }).tagName).toBe("svg");
		expect(view.container.querySelector("clipPath")).toBeNull();
		expect(view.container.querySelector(".lucide-ship")).toBeTruthy();
	});

	it("marks a conversation that ran a live eval with a flask, even while Autopick is on", () => {
		const state = conversation({ agent: "claude", hasEvals: true });
		const view = render(
			<ItemIcon
				conversation={{ ...state, autoPick: switched(state, true) }}
				agent="Claude"
			/>,
		);

		expect(view.getByRole("img", { name: "Claude" }).tagName).toBe("svg");
		expect(view.container.querySelector("clipPath")).toBeNull();
		expect(view.container.querySelector(".lucide-flask-conical")).toBeTruthy();
		expect(view.container.querySelector(".bg-orange-500\\/15")).toBeTruthy();
	});

	it("marks an eval conversation with the flask and orange badge in the mobile inbox", () => {
		const state = conversation({
			agent: "claude",
			title: "Eval run",
			hasEvals: true,
		});
		const view = render(
			<Row
				row={{ conversation: state, task: null, need: { kind: "idle" } }}
				depth={0}
				agent="Claude"
				hosting={false}
				onOpen={() => {}}
			/>,
		);

		expect(view.container.querySelector(".lucide-flask-conical")).toBeTruthy();
		expect(view.container.querySelector(".bg-orange-500\\/15")).toBeTruthy();
	});
});
