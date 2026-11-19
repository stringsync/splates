import { afterEach, describe, expect, it } from "bun:test";
import type { SignalProbe } from "@splates/server/signals";
import { ProbeCard } from "./probe-card";
import { ago, everyOf } from "./signal-of";
import { cleanup, render } from "./testing-library";

describe("probe card", () => {
	afterEach(cleanup);

	it("shows a running probe's runs, its last output and Stop probe", () => {
		const view = render(<ProbeCard probe={probe()} />);
		expect(view.getByText("Probing aws/stack-ready")).toBeTruthy();
		expect(
			view.getByText("Stack s2s-prod reaches UPDATE_COMPLETE"),
		).toBeTruthy();
		expect(view.getAllByRole("listitem")).toHaveLength(2);
		expect(view.getByText("UPDATE_IN_PROGRESS")).toBeTruthy();
		expect(view.getByRole("button", { name: "Stop probe" })).toBeTruthy();
	});

	it("says how it ended, with no Stop probe", () => {
		const view = render(
			<ProbeCard probe={probe({ state: "raised", passed: true })} />,
		);
		expect(view.getByText("Probe raised aws/stack-ready")).toBeTruthy();
		expect(view.getByText("Raised, probe stopped")).toBeTruthy();
		expect(view.queryByRole("button", { name: "Stop probe" })).toBeNull();
	});

	it("says intervals and ages shortly", () => {
		expect(everyOf(30_000)).toBe("30s");
		expect(everyOf(5 * 60_000)).toBe("5m");
		expect(ago(new Date(0).toISOString(), 90_000)).toBe("1m ago");
	});
});

const probe = (over: Partial<SignalProbe> = {}): SignalProbe => ({
	name: "aws/stack-ready",
	description: "Stack s2s-prod reaches UPDATE_COMPLETE",
	script: "aws cloudformation describe-stacks | jq -e .",
	everyMs: 5 * 60_000,
	cwd: "/repo",
	conversation: "c1",
	state: "running",
	startedAt: new Date().toISOString(),
	deadline: new Date(Date.now() + 6 * 3_600_000).toISOString(),
	passed: false,
	subscribed: true,
	count: 2,
	runs: [
		{ at: new Date(Date.now() - 300_000).toISOString(), exit: 1, output: "" },
		{
			at: new Date().toISOString(),
			exit: 1,
			output: "UPDATE_IN_PROGRESS",
		},
	],
	...over,
});
