import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ComponentProps } from "react";
import { SettingControls } from "./setting-controls";
import {
	act,
	cleanup,
	fireEvent,
	pick,
	render,
	waitFor,
	within,
} from "./testing";

describe("composer setting controls", () => {
	let offered: ReturnType<typeof model>;
	let changes: string[];
	let props: ComponentProps<typeof SettingControls>;
	let view: ReturnType<typeof render>;
	let layout: { content: number; available: number };
	const widths = ["offsetWidth", "clientWidth"].map(
		(name) =>
			[
				name,
				Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
			] as const,
	);
	afterEach(() => {
		cleanup();
		for (const [name, descriptor] of widths) {
			if (descriptor) {
				Object.defineProperty(HTMLElement.prototype, name, descriptor);
			} else {
				Reflect.deleteProperty(HTMLElement.prototype, name);
			}
		}
	});
	beforeEach(() => {
		layout = { content: 100, available: 1000 };
		Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
			configurable: true,
			get: () => layout.content,
		});
		Object.defineProperty(HTMLElement.prototype, "clientWidth", {
			configurable: true,
			get: () => layout.available,
		});
		offered = {
			...model("opencode-go/shared", []),
			options: ["opencode-go/shared", "openrouter/shared"].map((value) => ({
				value,
				name: "Shared",
				description: null,
			})),
		};
		changes = [];
		props = {
			settings: [offered],
			current: () => "opencode-go/shared",
			onChange: (_setting: unknown, value: string) => changes.push(value),
		};
		view = render(<SettingControls {...props} />);
	});
	it("distinguishes provider IDs, refreshes options, and folds long values into the dialog", async () => {
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
		layout.content = 1200;
		view.rerender(
			<SettingControls
				{...props}
				settings={[
					{
						...offered,
						options: offered.options.map((option) => ({
							...option,
							name: "Claude Sonnet with a very long model name",
						})),
					},
				]}
			/>,
		);
		expect(view.queryByRole("combobox")).toBeNull();
		const trigger = view.getByRole("button", { name: "settings" });
		expect(trigger.textContent).toBe(
			"Claude Sonnet with a very long model name",
		);
		await act(async () => fireEvent.click(trigger));
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() =>
				view.getByRole("option", {
					name: "Claude Sonnet with a very long model name (openrouter/shared)",
				}),
			),
		);
		expect(changes).toEqual(["openrouter/shared", "openrouter/shared"]);
	});
	it("collapses a crowded row even when its individual labels are short", () => {
		layout.available = 80;
		const settings = [
			"Model",
			"Mode",
			"Effort",
			"Approval",
			"Sandbox",
			"Service",
		].map((name) => ({
			...model("standard", ["Standard"]),
			id: name.toLowerCase(),
			name,
		}));
		view.rerender(
			<SettingControls
				settings={settings}
				current={(setting) => setting.current}
				onChange={() => {}}
			/>,
		);
		expect(view.queryByRole("combobox")).toBeNull();
		expect(view.getByRole("button", { name: "settings" })).toBeTruthy();
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
