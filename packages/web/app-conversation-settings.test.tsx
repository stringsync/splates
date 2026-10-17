import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SettingControls } from "./setting-controls";
import {
	AGENTS,
	act,
	cleanup,
	conversation,
	fireEvent,
	newWith,
	pick,
	render,
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

	it("distinguishes provider IDs and refreshes options without substituting a stale pick", async () => {
		const offered = {
			...model("opencode-go/shared", []),
			options: ["opencode-go/shared", "openrouter/shared"].map((value) => ({
				value,
				name: "Shared",
				description: null,
			})),
		};
		const changes: string[] = [];
		const props = {
			settings: [offered],
			current: () => "opencode-go/shared",
			onChange: (_setting: unknown, value: string) => changes.push(value),
		};
		const view = render(<SettingControls {...props} />);
		expect(view.getByRole("combobox").textContent).toContain(
			"OpenCode Go · Shared (opencode-go/shared)",
		);
		await act(async () => fireEvent.click(view.getByRole("combobox")));
		await pick(
			await waitFor(() =>
				view.getByRole("option", { name: "Shared (openrouter/shared)" }),
			),
		);
		expect(changes).toEqual(["openrouter/shared"]);
		view.rerender(
			<SettingControls
				{...props}
				settings={[
					{
						...offered,
						current: "openrouter/shared",
						options: [
							{
								value: "openrouter/shared",
								name: "Renamed",
								description: null,
							},
						],
					},
				]}
			/>,
		);
		expect(view.getByRole("combobox").textContent).toContain(
			"opencode-go/shared (unavailable)",
		);
		expect(view.getByRole("combobox").getAttribute("aria-invalid")).toBe(
			"true",
		);
		await act(async () => fireEvent.click(view.getByRole("combobox")));
		await waitFor(() =>
			expect(
				view.getByRole("option", { name: "Renamed (openrouter/shared)" }),
			).toBeTruthy(),
		);
		expect(view.queryByRole("option", { name: /opencode-go/ })).toBeNull();
		expect(changes).toEqual(["openrouter/shared"]);
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
		const held = [
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
		];
		held.push(
			conversation({
				id: "c3",
				agent: "opencode",
				settings: [
					{
						...model("opencode-go/first", []),
						options: ["first", "second"].map((name) => ({
							value: `opencode-go/${name}`,
							name,
							description: null,
						})),
					},
				],
			}),
		);
		const view = await testing.openConversations(
			held,
			null,
			{},
			[
				...AGENTS,
				{ id: "opencode", name: "OpenCode", settings: [], limits: [] },
			].map((agent) => ({
				...agent,
				settings: held.find((each) => each.agent === agent.id)?.settings ?? [],
			})),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: "Sonnet" })),
		);

		await newWith(view, "OpenCode");
		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() =>
				view.getByRole("option", { name: /opencode-go\/second/ }),
			),
		);
		await newWith(view, "Claude");
		expect(view.getByRole("combobox", { name: "model" }).textContent).toContain(
			"Opus",
		);
		await newWith(view, "Codex");

		await waitFor(() =>
			expect(
				view.getByRole("combobox", { name: "model" }).textContent,
			).toContain("Luna"),
		);
	});

	it("puts the settings behind one button on a phone, opening them in a dialog", async () => {
		// happy-dom's own handle on its window, which sizes what `matchMedia` reads.
		const { happyDOM } = window as unknown as {
			happyDOM: { setInnerWidth: (width: number) => void };
		};
		const wide = window.innerWidth;
		happyDOM.setInnerWidth(390);
		try {
			const view = await testing.openConversations([
				conversation({
					settings: [
						{
							id: "model",
							name: "Model",
							type: "select",
							category: "model",
							current: "opencode-go/big",
							options: [
								{ value: "opencode-go/big", name: "Big", description: null },
								{
									value: "opencode-go/small",
									name: "Small",
									description: null,
								},
							],
						},
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

			expect(view.queryByRole("combobox", { name: "model" })).toBeNull();
			const settings = view.getByRole("button", { name: "settings" });
			expect(settings.textContent).toContain(
				"OpenCode Go · Big (opencode-go/big)",
			);
			await act(async () => fireEvent.click(settings));
			const dialog = await waitFor(() => view.getByRole("dialog"));
			await act(async () =>
				fireEvent.click(
					within(dialog).getByRole("switch", { name: "Fast mode" }),
				),
			);
			await act(async () =>
				fireEvent.click(
					within(dialog).getByRole("combobox", { name: "model" }),
				),
			);
			await pick(
				await waitFor(() =>
					view.getByRole("option", {
						name: "OpenCode Go · Small (opencode-go/small)",
					}),
				),
			);

			expect(testing.posted("/api/conversations/c1/setting")).toEqual([
				{ method: "PUT", body: { id: "fast", value: "on" } },
				{ method: "PUT", body: { id: "model", value: "opencode-go/small" } },
			]);
		} finally {
			happyDOM.setInnerWidth(wide);
		}
	});
});

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
