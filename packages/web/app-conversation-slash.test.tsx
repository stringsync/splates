import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	textIn,
	waitFor,
} from "./testing";

describe("App's / key", () => {
	let testing: Testing;
	let other: HTMLInputElement;

	beforeEach(() => {
		testing = new Testing();
		other = document.createElement("input");
		document.body.append(other);
	});

	afterEach(() => {
		other.remove();
		cleanup();
		testing.dispose();
	});

	it("takes the keyboard to the composer, typing nothing, so the commands stay shut", async () => {
		const view = await testing.openConversations([conversation()]);
		const box = view.getByRole("textbox", { name: "Message input" });

		await act(async () => fireEvent.keyDown(document.body, { key: "/" }));

		await waitFor(() =>
			expect(box.contains(document.activeElement)).toBe(true),
		);
		expect(textIn(box)).toBe("");
		expect(view.queryByRole("listbox")).toBeNull();
	});

	it("leaves a / typed in another box to that box", async () => {
		await testing.openConversations([conversation()]);
		other.focus();

		await act(async () => fireEvent.keyDown(other, { key: "/" }));

		expect(document.activeElement).toBe(other);
	});
});
