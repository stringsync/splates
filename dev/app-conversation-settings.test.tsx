import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	newWith,
	pick,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's conversation settings", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("switches a setting, and archives the idle conversation at once, with no shell up", async () => {
		const view = await testing.openConversations([
			conversation({
				settings: [
					{
						id: "model",
						name: "Model",
						type: "select",
						category: "model",
						current: "big",
						options: [
							{ value: "big", name: "Big", description: null },
							{ value: "small", name: "Small", description: null },
						],
					},
				],
			}),
		]);

		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: "Small" })),
		);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("navigation", { name: "actions" })).getByRole(
					"button",
					{ name: /^Archive/ },
				),
			),
		);

		expect(view.queryByRole("dialog")).toBeNull();
		expect(testing.posted("/api/conversations/c1/setting")).toEqual([
			{ method: "PUT", body: { id: "model", value: "small" } },
		]);
		expect(testing.posted("/api/conversations/c1/archived")).toEqual([
			{ method: "PUT", body: { archived: true } },
		]);
	});

	it("shows an effort picker by its value alone", async () => {
		const view = await testing.openConversations([
			conversation({
				settings: [
					{
						id: "effort",
						name: "Effort",
						type: "select",
						category: "thought_level",
						current: "high",
						options: [
							{ value: "low", name: "Low", description: null },
							{ value: "high", name: "High", description: null },
						],
					},
				],
			}),
		]);

		const effort = view.getByRole("combobox", { name: "effort" });
		await waitFor(() => expect(effort.textContent).toContain("High"));
		expect(effort.textContent).not.toContain("Effort");
	});

	it("switches an on/off setting with a switch", async () => {
		const view = await testing.openConversations([
			conversation({
				settings: [
					{
						id: "fast",
						name: "Fast mode",
						type: "boolean",
						category: "model_config",
						current: "off",
						options: [
							{ value: "on", name: "On", description: null },
							{ value: "off", name: "Off", description: null },
						],
					},
				],
			}),
		]);

		const fast = view.getByRole("switch", { name: "Fast mode" });
		expect(fast.getAttribute("aria-checked")).toBe("false");
		await act(async () => fireEvent.click(fast));

		expect(testing.posted("/api/conversations/c1/setting")).toEqual([
			{ method: "PUT", body: { id: "fast", value: "on" } },
		]);
	});

	it("offers each agent's own settings on the home, a pick for one never reaching the other", async () => {
		const model = (current: string, names: string[]) => ({
			id: "model",
			name: "Model",
			type: "select" as const,
			category: "model",
			current,
			options: names.map((name) => ({
				value: name.toLowerCase(),
				name,
				description: null,
			})),
		});
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					settings: [model("opus", ["Opus", "Sonnet"])],
				}),
				conversation({
					id: "c2",
					agent: "codex",
					title: "Other",
					settings: [model("luna", ["Luna", "Sol"])],
				}),
			],
			null,
		);
		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: "Sonnet" })),
		);

		await newWith(view, "Codex");

		await waitFor(() =>
			expect(
				view.getByRole("combobox", { name: "model" }).textContent,
			).toContain("Luna"),
		);
	});
});
