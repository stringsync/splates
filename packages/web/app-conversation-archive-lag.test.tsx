import { afterEach, describe, expect, it } from "bun:test";
import {
	act,
	agentList,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	within,
} from "./testing";

describe("App's sidebar while an archive settles", () => {
	let testing: Testing;

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("holds the row pending, not gone, until the server's copy is archived, whatever arrives after the write", async () => {
		testing = new Testing();
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", task: "alpha", status: "stopped" }),
				conversation({ id: "c2", task: "beta", status: "stopped" }),
			],
			null,
		);
		const rows = () =>
			within(agentList(view)).queryAllByRole("button", {
				name: /Archive alpha/,
			}).length;
		expect(rows()).toBe(1);
		// The row says a write is pending on it, from its first line.
		const pending = () =>
			within(agentList(view)).queryAllByRole("listitem").length > 0 &&
			agentList(view).querySelector('[aria-busy="true"]') !== null;
		expect(pending()).toBe(false);
		testing.holdWrites();
		await act(async () =>
			fireEvent.click(
				within(agentList(view)).getByRole("button", { name: "Archive alpha" }),
			),
		);
		// Pending, not gone: the row shows the server's word until it says so.
		expect(rows()).toBe(1);
		expect(pending()).toBe(true);
		await act(async () => testing.release());
		expect(rows()).toBe(1);
		expect(pending()).toBe(true);
		// The server's stream was a step behind the write's answer.
		await testing.say(
			conversation({
				id: "c1",
				task: "alpha",
				status: "stopped",
				title: "late",
			}),
		);
		expect(rows()).toBe(1);
		expect(pending()).toBe(true);
		await testing.say(
			conversation({
				id: "c1",
				task: "alpha",
				status: "stopped",
				archived: true,
			}),
		);
		expect(rows()).toBe(0);
		// Brought back from elsewhere once the server has it archived.
		await testing.say(
			conversation({ id: "c1", task: "alpha", status: "stopped" }),
		);
		expect(rows()).toBe(1);
	});
});
