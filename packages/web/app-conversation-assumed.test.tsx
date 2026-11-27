import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
} from "./testing";
import { withAssumed } from "./thread-reply";

describe("Assumed lines in a conversation", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const reply = [
		"Retrying scans now.",
		"",
		"🛡 Assumed: Retry limit: 3 (vs 5 · defaults)",
		"🛡 Assumed: Backoff: linear (vs exponential · design)",
	].join("\n");

	it("splits each Assumed line out of the text, numbered on from those before", () => {
		const { parts, count } = withAssumed(reply, 2);
		expect(count).toBe(2);
		expect(parts).toEqual([
			{ type: "text", text: "Retrying scans now." },
			{
				type: "data-assumed",
				data: {
					assumed: "Retry limit: 3",
					alternative: "5",
					kind: "defaults",
					number: 3,
				},
			},
			{
				type: "data-assumed",
				data: {
					assumed: "Backoff: linear",
					alternative: "exponential",
					kind: "design",
					number: 4,
				},
			},
		]);
		expect(withAssumed("```\n🛡 Assumed: a (vs b · design)\n```", 0).count).toBe(
			0,
		);
	});

	it("draws each as a line whose Overturn tells the agent to switch, by its number in the conversation", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "retry failed scans"),
					message("agent", "🛡 Assumed: Queue: in memory (vs on disk · design)"),
					message("user", "ok"),
					message("agent", reply),
				],
			}),
		]);
		const line = await waitFor(() =>
			view.getByText("Backoff: linear").closest("[data-slot='splates-event']"),
		);
		expect(line?.textContent).toContain("(vs exponential · API / design)");
		expect(view.queryByText(/🛡 Assumed:/)).toBeNull();

		const buttons = view.getAllByRole("button", { name: "Overturn" });
		expect(buttons).toHaveLength(3);
		await act(async () => fireEvent.click(buttons[2] as HTMLElement));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: "[SPLATES OVERTURN 3] Backoff: linear → exponential",
				},
			},
		]);
	});

	it("draws an overturn as Overturned, and the line it overturned says so", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "retry failed scans"),
					message("agent", reply),
					message("user", "[SPLATES OVERTURN 1] Retry limit: 3 → 5"),
				],
			}),
		]);
		await waitFor(() => view.getByText("Retry limit: 3 → 5"));
		// The overturn's own line, and the Assumed line in place of its button.
		expect(view.getAllByText("Overturned")).toHaveLength(2);
		expect(view.getAllByRole("button", { name: "Overturn" })).toHaveLength(1);
	});
});
