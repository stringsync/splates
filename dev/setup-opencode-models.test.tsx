import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenCodeModelControls } from "./setup-opencode-models";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

const main = "opencode-go/Case.Main";
const auxiliary = "opencode-go/Small";
describe("OpenCode model controls", () => {
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
		testing.opencodeModels.catalog = {
			models: [main, auxiliary],
			checkedAt: "fixture",
			problem: null,
		};
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});
	it("requires explicit selection, a preview, and Console confirmation before applying", async () => {
		const view = render(<OpenCodeModelControls />);
		await waitFor(() => expect(view.getByText(/Catalog checked/)).toBeTruthy());
		expect(testing.posts).toEqual([]);
		expect(
			(
				view.getByRole("button", {
					name: "Review changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.change(view.getByLabelText("Main model"), {
			target: { value: main },
		});
		fireEvent.change(view.getByLabelText("Auxiliary model"), {
			target: { value: auxiliary },
		});
		testing.reply = {
			...testing.opencodeModels,
			preview: {
				model: main,
				auxiliary,
				token: "fixture-token",
				path: "/fixture/agents.json",
				agents: ["build", "title"],
				config: { model: main },
			},
		};
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Review changes" })),
		);
		await waitFor(() =>
			expect(
				view.getByRole("button", { name: "Apply OpenCode experiment" }),
			).toBeTruthy(),
		);
		expect(testing.posted("/api/setup/opencode/models/preview")).toEqual([
			{ method: "POST", body: { model: main, auxiliary } },
		]);
		expect(
			(
				view.getByRole("button", {
					name: "Apply OpenCode experiment",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.click(
			view.getByRole("switch", {
				name: "I confirmed Use balance is off in Console",
			}),
		);
		testing.reply = {
			...testing.opencodeModels,
			saved: { model: main, auxiliary },
		};
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Apply OpenCode experiment" }),
			),
		);
		await waitFor(() =>
			expect(view.getByText(/Experiment configuration saved/)).toBeTruthy(),
		);
		expect(testing.posted("/api/setup/opencode/models/apply")).toEqual([
			{ method: "POST", body: { token: "fixture-token", balanceOff: true } },
		]);
	});
	it("keeps stale selections visible and disables applying after a refresh removes them", async () => {
		const view = render(<OpenCodeModelControls />);
		await waitFor(() => expect(view.getByText(/Catalog checked/)).toBeTruthy());
		fireEvent.change(view.getByLabelText("Main model"), {
			target: { value: main },
		});
		fireEvent.change(view.getByLabelText("Auxiliary model"), {
			target: { value: auxiliary },
		});
		testing.reply = {
			...testing.opencodeModels,
			catalog: { models: [auxiliary], checkedAt: "new", problem: null },
		};
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Refresh Go models" })),
		);
		await waitFor(() =>
			expect(view.getByText(/unavailable; choose again/)).toBeTruthy(),
		);
		expect(
			(
				view.getByRole("button", {
					name: "Review changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(
			view.queryByRole("button", { name: "Apply OpenCode experiment" }),
		).toBeNull();
	});
	it("displays discovery errors and retries without an agent conversation", async () => {
		testing.opencodeModels.catalog = {
			models: [],
			checkedAt: null,
			problem: "No Go models could be listed. Retry.",
		};
		const view = render(<OpenCodeModelControls />);
		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain("No Go models"),
		);
		testing.reply = {
			...testing.opencodeModels,
			catalog: { models: [main], checkedAt: "retry", problem: null },
		};
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Refresh Go models" })),
		);
		await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
		expect(testing.posted("/api/setup/opencode/models/refresh")).toHaveLength(
			1,
		);
	});
});
