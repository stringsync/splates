import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SignalOverview } from "@splates/server/signals";
import { SignalsPage, signalsAt } from "./signals-page";
import { cleanup, fireEvent, render, waitFor } from "./testing-library";

describe("signals page", () => {
	const real = globalThis.fetch;
	beforeEach(() => {
		location.hash = "#signals";
		globalThis.fetch = (async () =>
			Response.json({ signals: SIGNALS, armed: 0 })) as unknown as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = real;
		cleanup();
	});

	it("reads which signal or check form the address shows", () => {
		expect(signalsAt("#signals")).toEqual({ check: null, signal: null });
		expect(signalsAt("#signals/new")).toEqual({ check: "new", signal: null });
		expect(signalsAt("#signals/mono.task.done")).toEqual({
			check: null,
			signal: "mono.task.done",
		});
		expect(signalsAt("#signals/mono.task.done/check")).toEqual({
			check: "mono.task.done",
			signal: null,
		});
	});

	it("lists each signal under its family with its week's count, and shows the latest in full", async () => {
		const page = render(<SignalsPage onOpen={() => {}} />);
		const started = await page.findByRole("link", {
			name: "signal mono.task.started",
		});
		expect(started.textContent).toBe("started2");
		expect(started.getAttribute("aria-current")).toBe("true");
		expect(
			page.getByRole("button", { name: /mono\.task/ }).textContent,
		).toContain("3");
		const detail = page.getByRole("region", {
			name: "signal mono.task.started",
		});
		expect(detail.textContent).toContain("Raises per day");
		expect(page.getByRole("img", { name: "Today: 2 raises" })).toBeTruthy();
		expect(page.getByRole("link", { name: "#3149" }).getAttribute("href")).toBe(
			"#todos/3149",
		);
		expect(page.queryByText(/"task": "proposal-as-question"/)).toBeNull();
	});

	it("opens a raise to its raw payload", async () => {
		const page = render(<SignalsPage onOpen={() => {}} />);
		fireEvent.click(await page.findByText("proposal-as-question"));
		expect(page.getByText(/"task": "proposal-as-question"/)).toBeTruthy();
	});

	it("folds a family", async () => {
		const page = render(<SignalsPage onOpen={() => {}} />);
		await page.findByRole("link", { name: "signal mono.task.done" });
		fireEvent.click(page.getByRole("button", { name: /mono\.task/ }));
		await waitFor(() =>
			expect(
				page.queryByRole("link", { name: "signal mono.task.done" }),
			).toBeNull(),
		);
	});

	it("shows the signal the address names", async () => {
		location.hash = "#signals/mono.task.done";
		const page = render(<SignalsPage onOpen={() => {}} />);
		expect(
			await page.findByRole("region", { name: "signal mono.task.done" }),
		).toBeTruthy();
	});
});

const ago = (minutes: number) =>
	new Date(Date.now() - minutes * 60_000).toISOString();

const SIGNALS: SignalOverview[] = [
	{
		name: "mono.task.started",
		project: "mono",
		armed: false,
		probe: null,
		subscribers: [],
		raises: [
			{
				at: ago(0.2),
				by: "splates",
				payload: { numbers: [], task: "eval-judge-picker" },
			},
			{
				at: ago(0.3),
				by: "splates",
				payload: { numbers: [3149], task: "proposal-as-question" },
			},
		],
	},
	{
		name: "mono.task.done",
		project: "mono",
		armed: false,
		probe: null,
		subscribers: [],
		raises: [
			{ at: ago(0.25), by: "splates", payload: { task: "signal-dot-names" } },
		],
	},
];
