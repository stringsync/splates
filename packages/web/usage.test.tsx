import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { blank } from "@stringsync/splates-server/conversations/browser";
import { cleanup, fireEvent, render, waitFor } from "./testing";
import { ContextMeter, OpenCodeReport } from "./usage";

afterEach(cleanup);

describe("Context usage display", () => {
	it.each([null, { size: 0, used: 0 }])(
		"keeps usage reachable while context is %j and updates the open control in place",
		async (context) => {
			const state = blank("c", "claude", null, "2026-10-17T12:00:00Z");
			state.usage.context = context;
			const view = render(<ContextMeter usage={state.usage} />);
			const control = view.getByRole("button", {
				name: "Context usage not reported",
			});
			fireEvent.click(control);
			await waitFor(() =>
				expect(
					view.getByRole("region", { name: "Context" }).textContent,
				).toContain("Not reported by the agent"),
			);
			view.rerender(
				<ContextMeter
					usage={{ ...state.usage, context: { size: 200000, used: 20000 } }}
				/>,
			);
			expect(view.getByRole("button", { name: "10% of context used" })).toBe(
				control,
			);
			expect(
				view.getByRole("region", { name: "Context" }).textContent,
			).toContain("10%");
			view.rerender(<ContextMeter usage={state.usage} />);
			expect(
				view.getByRole("button", { name: "Context usage not reported" }),
			).toBe(control);
			expect(
				view.getByRole("region", { name: "Context" }).textContent,
			).toContain("Not reported by the agent");
		},
	);

	it("opens without context and labels missing metrics as unknown", async () => {
		const state = blank("c", "opencode", null, "2026-10-17T12:00:00Z");
		const view = render(<ContextMeter usage={state.usage} />);
		fireEvent.click(view.getByRole("button", { name: "OpenCode usage" }));
		const section = await waitFor(() =>
			view.getByRole("region", { name: "Last turn tokens" }),
		);
		expect(section.textContent).toContain("Unknown in");
		expect(
			view.getByRole("region", { name: "Reported cost" }).textContent,
		).toContain("Unknown");
		expect(
			view.getByRole("link", { name: "OpenCode Console" }).getAttribute("href"),
		).toBe("https://opencode.ai/console");
	});

	it("separates cumulative reported cost, unknown charges and parent-only per-turn tokens", () => {
		const state = blank("c", "opencode", null, "2026-10-17T12:00:00Z");
		state.usage.cost = { amount: 0, said: 0, currency: "USD" };
		state.usage.opencode?.turns.push({
			at: "2026-10-17T12:00:00Z",
			firstText: "2026-10-17T12:00:01Z",
			until: "2026-10-17T12:00:03Z",
			requested: "opencode-go/test",
			confirmed: "opencode-go/test",
			cwd: "/repo",
			tokens: { input: 0, output: 5, cachedRead: null, cachedWrite: 0 },
		});
		const view = render(<OpenCodeReport usage={state.usage} />);
		expect(
			view.getByRole("region", { name: "Last dispatched model" }).textContent,
		).toContain("opencode-go/test");
		expect(
			view.getByRole("region", { name: "Last turn tokens" }).textContent,
		).toContain("parent session only");
		expect(
			view.getByRole("region", { name: "Measured latency" }).textContent,
		).toContain("First text: 1000 ms");
		expect(
			view.getByRole("region", { name: "Reported cost" }).textContent,
		).toContain("0.00 USD");
		expect(
			view.getByRole("region", { name: "Reported cost" }).textContent,
		).toContain("cumulative session total");
		expect(
			view.getByRole("region", { name: "Additional charges" }).textContent,
		).toContain("Unknown");
		expect(
			view.getByRole("region", { name: "Remaining quota" }).textContent,
		).toContain("reset time unknown");
	});
});
