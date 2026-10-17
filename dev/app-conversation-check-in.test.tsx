import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Message } from "../conversations";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	tool,
	waitFor,
	within,
} from "./testing";

describe("App's check-in on a long turn", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("asks an agent ten minutes at work where its work stands, under its Working line", async () => {
		const view = await testing.openConversations([workingFor(12)]);
		const work = await waitFor(() =>
			view.container.ownerDocument.querySelector('[data-slot="work"]'),
		);
		expect(work?.textContent).toContain("Working 12m");

		await act(async () =>
			fireEvent.click(
				within(work as HTMLElement).getByRole("button", { name: "Check in" }),
			),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[ARBOR UPDATE]" } },
		]);
	});

	it("freezes working time at a pending permission request", async () => {
		const state = workingFor(12);
		const view = await testing.openConversations([
			{
				...state,
				ask: {
					type: "permission",
					id: "t1",
					at: new Date(Date.now() - 4 * 60_000).toISOString(),
					title: "bun test",
					options: [],
				},
			},
		]);
		await waitFor(() => view.getByText("Working 8m 0s"));
		expect(view.queryByRole("button", { name: "Check in" })).toBeNull();
	});

	it("offers none before ten minutes", async () => {
		const view = await testing.openConversations([workingFor(8)]);
		await waitFor(() => view.getByText(/^Working 8m/));
		expect(view.queryByRole("button", { name: "Check in" })).toBeNull();
	});

	it("counts from the agent's reply while its turn goes on after it", async () => {
		const view = await testing.openConversations([repliedAfter(16, 6)]);
		await waitFor(() => view.getByText(/^Working 16m/));
		expect(view.queryByRole("button", { name: "Check in" })).toBeNull();
	});

	it("asks once the agent's reply is ten minutes old", async () => {
		const view = await testing.openConversations([repliedAfter(16, 11)]);
		await waitFor(() => view.getByRole("button", { name: "Check in" }));
	});

	it("offers none while a message waits for the agent", async () => {
		const view = await testing.openConversations([
			workingFor(12, { ...message("user", "and the footer"), queued: true }),
		]);
		expect(view.queryByRole("button", { name: "Check in" })).toBeNull();
	});

	it("offers none once the person has said something since", async () => {
		const view = await testing.openConversations([
			workingFor(12, { ...message("user", "and the footer"), steered: true }),
		]);
		await waitFor(() => view.getByText("and the footer"));
		expect(view.queryByRole("button", { name: "Check in" })).toBeNull();
	});

	it("offers none while the agent waits on the person to answer what it asks", async () => {
		const view = await testing.openConversations([
			{
				...workingFor(12),
				ask: {
					type: "permission",
					id: "t1",
					at: new Date().toISOString(),
					title: "bun test",
					options: [{ id: "yes", name: "Allow", kind: "allow_once" }],
				},
			},
		]);
		await waitFor(() => view.getByRole("generic", { name: "permission" }));
		expect(view.queryByRole("button", { name: "Check in" })).toBeNull();
	});

	it("offers none while the agent starts up under a turn that is over", async () => {
		const view = await testing.openConversations([
			{ ...workingFor(12), status: "starting" },
		]);
		const work = await waitFor(() =>
			view.container.ownerDocument.querySelector('[data-slot="work"]'),
		);
		expect(work?.textContent).not.toContain("Working");
		expect(view.queryByRole("button", { name: "Check in" })).toBeNull();
	});
});

/** A running conversation whose agent began its work `minutes` ago. */
function workingFor(minutes: number, ...more: Message[]) {
	const at = new Date(Date.now() - minutes * 60_000).toISOString();
	return conversation({
		status: "running",
		messages: [
			message("user", "fix the header"),
			{
				...message(
					"agent",
					tool({ command: "bun test", status: "in_progress", at }),
				),
				at,
				until: new Date().toISOString(),
			},
			...more,
		],
	});
}

/**
 * A running conversation whose agent began `minutes` ago and replied
 * `replied` minutes ago, its turn still going, as while its subagents work.
 */
function repliedAfter(minutes: number, replied: number) {
	const ago = (each: number) =>
		new Date(Date.now() - each * 60_000).toISOString();
	return conversation({
		status: "running",
		messages: [
			message("user", "work down lane 3"),
			{
				...message(
					"agent",
					tool({
						command: "arbor list",
						status: "completed",
						at: ago(minutes),
					}),
					{ type: "text", text: "Working lane 3", at: ago(replied) },
				),
				at: ago(minutes),
				until: new Date().toISOString(),
			},
		],
	});
}
