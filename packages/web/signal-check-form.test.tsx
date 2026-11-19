import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SignalProbe } from "@splates/server/signals";
import { checkFormOf, SignalCheckForm } from "./signal-check-form";
import { cleanup, fireEvent, render, waitFor } from "./testing-library";

const probe = (): SignalProbe => ({
	name: "aws/stack-ready",
	description: "stack up",
	script: "aws describe | grep DONE",
	everyMs: 300_000,
	cwd: "/repo",
	conversation: "",
	state: "idle",
	startedAt: "2026-11-19T12:00:00.000Z",
	deadline: "2026-11-19T18:00:00.000Z",
	passed: null,
	subscribed: false,
	count: 0,
	runs: [],
});

describe("signal check form", () => {
	const sent: { path: string; body: Record<string, unknown> }[] = [];
	const real = globalThis.fetch;
	beforeEach(() => {
		sent.length = 0;
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			sent.push({
				path: String(path),
				body: JSON.parse(String(init?.body ?? "{}")),
			});
			return Response.json(
				String(path).includes("check-test")
					? { exit: 1, output: "still building", ms: 800 }
					: {},
			);
		}) as unknown as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = real;
		cleanup();
	});

	it("fills the form from a probe, with its timeout as how long it runs", () => {
		expect(checkFormOf(probe(), "")).toEqual({
			name: "aws/stack-ready",
			description: "stack up",
			script: "aws describe | grep DONE",
			every: "5m",
			timeout: "6h",
		});
	});

	it("tests the command without saving, and says what it would do", async () => {
		const page = render(
			<SignalCheckForm
				initial={checkFormOf(probe(), "")}
				isNew={false}
				onBack={() => {}}
			/>,
		);
		fireEvent.click(page.getByRole("button", { name: "Test now" }));

		await waitFor(() => expect(page.getByText(/would fail/)).toBeTruthy());
		expect(page.getByText(/still building/)).toBeTruthy();
		expect(sent.map((each) => each.path)).toEqual(["/api/signals/check-test"]);
		expect(sent[0]?.body).toEqual({
			name: "aws/stack-ready",
			script: "aws describe | grep DONE",
		});
	});

	it("saves and starts the check, then goes back", async () => {
		let back = 0;
		const page = render(
			<SignalCheckForm
				initial={checkFormOf(null, "aws/new-one")}
				isNew
				onBack={() => {
					back += 1;
				}}
			/>,
		);
		fireEvent.change(page.getByLabelText("What it waits for"), {
			target: { value: "it is up" },
		});
		fireEvent.change(page.getByLabelText("Command"), {
			target: { value: "true" },
		});
		fireEvent.click(page.getByRole("button", { name: "Save and start" }));

		await waitFor(() => expect(back).toBe(1));
		expect(sent[0]).toEqual({
			path: "/api/signals/check",
			body: {
				name: "aws/new-one",
				description: "it is up",
				script: "true",
				every: "5m",
				timeout: "6h",
			},
		});
	});
});
