import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { switched } from "@stringsync/splates-server/conversations/browser";
import { RowIcon } from "./agent-icons";
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

	it("uses the hybrid mark while Auto pick is on", () => {
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

	it("uses the regular mark once Auto pick is off", () => {
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
});
