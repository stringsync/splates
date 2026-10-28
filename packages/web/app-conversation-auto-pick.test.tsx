import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Setting } from "@stringsync/splates-server/conversations";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	pick,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's Auto pick in the composer's settings", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("switches Auto pick on with the switch beside the Model picker, once the server says so", async () => {
		const view = await testing.openConversations([
			conversation({ settings: [MODEL] }),
		]);

		const model = view.getByRole("combobox", { name: "model" });
		await act(async () => fireEvent.click(model));
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("switch", { name: "Auto pick" })),
			),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/auto-pick")).toEqual([
				{ method: "PUT", body: { on: true } },
			]),
		);
		expect(model.textContent).not.toContain("Auto · Small");
		await testing.say(conversation({ settings: [MODEL], autoPick: PICKED }));
		await waitFor(() => expect(model.textContent).toContain("Auto · Small"));
	});

	it("keeps Auto pick on, and the list open, when the person picks a model", async () => {
		const view = await testing.openConversations([
			conversation({ settings: [MODEL], autoPick: PICKED }),
		]);

		const model = view.getByRole("combobox", { name: "model" });
		expect(model.textContent).toContain("Auto · Small");
		await act(async () => fireEvent.click(model));
		await pick(await waitFor(() => view.getByRole("option", { name: "Big" })));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/setting")).toHaveLength(1),
		);
		expect(model.textContent).toContain("Auto");
		expect(view.getByRole("switch", { name: "Auto pick" })).toBeTruthy();
		expect(testing.posted("/api/conversations/c1/setting")).toEqual([
			{ method: "PUT", body: { id: "model", value: "big" } },
		]);
	});

	it("switches Auto pick off from the settings sheet on a phone, its button's mark losing the sparkles' half once the server says so", async () => {
		// happy-dom's own handle on its window, which sizes what `matchMedia` reads.
		const { happyDOM } = window as unknown as {
			happyDOM: { setInnerWidth: (width: number) => void };
		};
		const wide = window.innerWidth;
		happyDOM.setInnerWidth(390);
		try {
			const view = await testing.openConversations([
				conversation({ settings: [MODEL], autoPick: PICKED }),
			]);

			const settings = view.getByRole("button", { name: "settings" });
			// Claude's mark, in its maker's orange, shares a split with the sparkles.
			const claude = 'path[fill="#D97757"]';
			expect(settings.querySelector(claude)).not.toBeNull();
			expect(settings.querySelectorAll("clipPath")).toHaveLength(2);
			await act(async () => fireEvent.click(settings));
			const dialog = await waitFor(() => view.getByRole("dialog"));
			const auto = within(dialog).getByRole("switch", { name: "Auto pick" });
			expect(auto.getAttribute("aria-checked")).toBe("true");
			await act(async () => fireEvent.click(auto));

			expect(testing.posted("/api/conversations/c1/auto-pick")).toEqual([
				{ method: "PUT", body: { on: false } },
			]);
			expect(auto.getAttribute("aria-checked")).toBe("true");
			await testing.say(
				conversation({
					settings: [MODEL],
					autoPick: { ...PICKED, overridden: true },
				}),
			);
			expect(auto.getAttribute("aria-checked")).toBe("false");
			expect(settings.querySelector(claude)).not.toBeNull();
			expect(settings.querySelector("clipPath")).toBeNull();
		} finally {
			happyDOM.setInnerWidth(wide);
		}
	});
});

const MODEL: Setting = {
	id: "model",
	name: "Model",
	type: "select",
	category: "model",
	current: "small",
	options: [
		{ value: "big", name: "Big", description: null },
		{ value: "small", name: "Small", description: null },
	],
};

/** What Auto pick set the conversation to as it started. */
const PICKED = {
	rule: 0,
	kind: "bugfix",
	depth: "shallow",
	agent: "claude",
	model: "small",
	effort: null,
	overridden: false,
};
