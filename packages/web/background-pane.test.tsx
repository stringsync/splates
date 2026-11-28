import { describe, expect, it } from "bun:test";
import type { Background } from "@splates/server/conversations";
import { BackgroundPane } from "./background-pane";
import { render } from "./testing-library";

const command = (overrides: Partial<Background> = {}): Background => ({
	id: "b1",
	name: "bun dev",
	command: "bun dev",
	subagent: null,
	state: "running",
	output: null,
	...overrides,
});

const pane = (background: Background) =>
	render(
		<BackgroundPane
			conversation="c1"
			background={background}
			phone={false}
			onClose={() => {}}
		/>,
	);

describe("BackgroundPane", () => {
	it("offers Stop for a command the agent reported", () => {
		const page = pane(command());

		expect(page.queryByRole("button", { name: /Stop/ })).not.toBeNull();
		expect(page.container.textContent).not.toContain("agent's processes");
		page.unmount();
	});

	it("offers Stop for a process found running in the agent's processes", () => {
		const page = pane(command({ id: "pid:600", pid: 600, name: "sleep 60" }));

		expect(page.queryByRole("button", { name: /Stop/ })).not.toBeNull();
		expect(page.container.textContent).toContain(
			"Found running in the agent's processes, pid 600",
		);
		page.unmount();
	});

	it("hides Stop when a command is marked canStop: false", () => {
		const page = pane(
			command({ id: "b2", canStop: false, name: "unstoppable" }),
		);

		expect(page.queryByRole("button", { name: /Stop/ })).toBeNull();
		page.unmount();
	});
});
