import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	waitFor,
} from "./testing";

describe("App's asks and settings, pending until the server says so", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("holds a permission's card pending at the answer, so a second key sends nothing, and frees it when refused", async () => {
		const view = await testing.openConversations([
			conversation({
				status: "running",
				ask: {
					type: "permission",
					id: "t1",
					at: "2026-10-11T10:00:00.000Z",
					title: "rm -rf build",
					options: [
						{ id: "yes", name: "Allow", kind: "allow_once" },
						{ id: "no", name: "Reject", kind: "reject_once" },
					],
				},
			}),
		]);
		testing.holdWrites();

		await act(async () => fireEvent.keyDown(document.body, { key: "1" }));
		await act(async () => fireEvent.keyDown(document.body, { key: "2" }));

		expect(testing.posted("/api/conversations/c1/answer")).toEqual([
			{
				method: "POST",
				body: { ask: "t1", answer: { type: "permission", option: "no" } },
			},
		]);
		// Still there, with the server's word, though busy.
		const card = view.getByRole("generic", { name: "permission" });
		expect(card.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");

		testing.refuseWrites = { reason: "usage", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() =>
			expect(
				view
					.getByRole("generic", { name: "permission" })
					.closest("[aria-busy]")
					?.getAttribute("aria-busy"),
			).toBe("false"),
		);
		// Under the row as well as the card.
		expect(view.getAllByText("Not answered: locked").length).toBeGreaterThan(0);
	});

	it("keeps a switched setting as the server has it, pending, and says why when refused", async () => {
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
		testing.holdWrites();

		await act(async () => fireEvent.click(fast));
		expect(fast.getAttribute("aria-checked")).toBe("false");

		testing.refuseWrites = { reason: "usage", message: "locked" };
		await act(async () => testing.release());
		await waitFor(() =>
			expect(view.getByText("Fast mode not switched: locked")).toBeTruthy(),
		);
		expect(fast.getAttribute("aria-checked")).toBe("false");
		expect(view.getByText("Fast mode not switched: locked")).toBeTruthy();
	});
});
