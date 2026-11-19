import { expect, test } from "bun:test";
import "./testing";
import { CANNED_RESPONSES, CannedStore, withCanned } from "./canned-responses";

test("an empty box takes the reply", () => {
	expect(withCanned("", "Go.")).toBe("Go.");
	expect(withCanned("  \n", "Go.")).toBe("Go.");
});

test("written text is kept and the reply follows on a new line", () => {
	expect(withCanned("Hmm.", "Go.")).toBe("Hmm.\nGo.");
	expect(withCanned("Hmm.\n", "Go.")).toBe("Hmm.\nGo.");
});

test("reads the default until set, keeps edits, and resets", () => {
	localStorage.clear();
	const store = new CannedStore(localStorage);
	expect(store.get()).toBe(CANNED_RESPONSES);
	store.set([{ label: "A", replies: ["x"] }]);
	expect(new CannedStore(localStorage).get()).toEqual([
		{ label: "A", replies: ["x"] },
	]);
	store.reset();
	expect(new CannedStore(localStorage).get()).toBe(CANNED_RESPONSES);
});
