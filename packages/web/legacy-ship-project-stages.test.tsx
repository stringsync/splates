import { afterEach, expect, it } from "bun:test";
import type {
	Cascade,
	CascadeStep,
	StageKey,
} from "@splates/server/legacy-ship";
import "./register-dom";
import { ProjectStages } from "./legacy-ship-project-stages";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

it.each([false, true])(
	"hides inapplicable historical stages (live=%s)",
	(live) => {
		const view = render(
			<ProjectStages
				cascade={{ steps: [upstream] } as Cascade}
				ship={null}
				live={live}
			/>,
		);
		expect(view.queryByText("Wait for upstream live")).toBeNull();
		expect(view.queryByText("Adopt")).toBeNull();
	},
);

it("names target package versions and preserves applicable skipped stages", () => {
	const downstream = {
		...upstream,
		slug: "vexml",
		takes: [
			{
				project: "mdom",
				pins: [{ name: "@stringsync/mdom", version: "0.8.15" }],
			},
		],
	};
	const view = render(
		<ProjectStages
			cascade={{ steps: [upstream, downstream] } as Cascade}
			ship={null}
			live={false}
		/>,
	);
	expect(
		view.getByText("Wait for @stringsync/mdom 0.8.16 on npm"),
	).toBeTruthy();
	expect(view.getByText("Update to @stringsync/mdom 0.8.16")).toBeTruthy();
});

it("keeps agent adoption without upstream and names deploy dependencies", () => {
	const downstream = {
		...upstream,
		slug: "app",
		takes: [{ project: "mdom", pins: [] }],
	};
	const view = render(
		<ProjectStages
			cascade={
				{ steps: [{ ...upstream, adopt: "agent" }, downstream] } as Cascade
			}
			ship={null}
			live={false}
		/>,
	);
	expect(view.getByText("Adopt")).toBeTruthy();
	expect(view.getByText("Wait for mdom live")).toBeTruthy();
	expect(view.getByText("Update to mdom")).toBeTruthy();
});

const upstream: CascadeStep = {
	from: "0.8.15",
	bump: "patch",
	publishes: [],
	why: "selected",
	task: null,
	ship: null,
	published: [],
	note: null,
	slug: "mdom",
	to: "0.8.16",
	action: "ship",
	status: "done",
	takes: [],
	stages: (["upstream", "adopt"] as StageKey[]).map((key) => ({
		key,
		started: null,
		ended: null,
		expected: 0,
		known: false,
		deadline: null,
		check: null,
		log: null,
		name: key === "upstream" ? "Wait for upstream live" : "Adopt",
		state: "skipped",
	})),
};
