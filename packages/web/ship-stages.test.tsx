import { afterEach, describe, expect, it } from "bun:test";
import type {
	Cascade,
	CascadeStep,
	Stage,
} from "@stringsync/splates-server/ship";
import "./register-dom";
import { StageRow } from "./ship-stages";
import { cleanup, render, within } from "./testing-library";

describe("StageRow release steps", () => {
	afterEach(cleanup);

	it("lists a project's release steps under its ship command", () => {
		const view = show(
			command([
				step("a", "done"),
				step("b", "failed", { error: "tsc broke" }),
				step("c", "pending", { started: null, ended: null }),
				step("d", "skipped"),
			]),
		);
		const list = view.getByRole("list", { name: "Release steps" });
		expect(within(list).getAllByRole("listitem")).toHaveLength(4);
		expect(within(list).getByText("tsc broke")).toBeTruthy();
		expect(within(list).getByText("already done")).toBeTruthy();
	});

	it("shows the command alone when its project reports no steps", () => {
		const view = show(command());
		expect(view.queryByRole("list", { name: "Release steps" })).toBeNull();
		expect(view.getByText("Ship command")).toBeTruthy();
	});
});

function step(id: string, state: string, extra = {}) {
	return {
		id,
		name: id.toUpperCase(),
		stage: "build",
		packages: [],
		state,
		started: "2026-10-30T12:00:00.000Z",
		ended: state === "running" ? null : "2026-10-30T12:00:05.000Z",
		deadlineMs: 60_000,
		checked: null,
		error: null,
		...extra,
	};
}

function command(releaseSteps?: unknown[]): Stage {
	return {
		key: "command",
		name: "Ship command",
		state: "done",
		started: "2026-10-30T12:00:00.000Z",
		ended: "2026-10-30T12:01:00.000Z",
		expected: 1000,
		known: false,
		deadline: null,
		check: null,
		log: null,
		releaseSteps,
	} as unknown as Stage;
}

function show(stage: Stage) {
	return render(
		<ol>
			<StageRow
				cascade={{} as Cascade}
				step={{} as CascadeStep}
				stage={stage}
				ship={null}
				live={false}
			/>
		</ol>,
	);
}
