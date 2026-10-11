import { describe, expect, it } from "bun:test";
import { Drafts, newDraft } from "./drafts";

/** A storage that refuses every write, as a private window's can. */
const refusing = {
	getItem: () => null,
	setItem: () => {
		throw new Error("QuotaExceededError");
	},
	removeItem: () => {},
} as unknown as Storage;

describe("Drafts", () => {
	it("keeps a draft for the page when storage refuses it", () => {
		const drafts = new Drafts(refusing);

		drafts.write("c1", "still here");
		expect(drafts.read("c1")).toBe("still here");

		drafts.write("c1", "");
		expect(drafts.read("c1")).toBe("");
	});

	it("says which draft was written", () => {
		const drafts = new Drafts(refusing);
		const written: string[] = [];
		drafts.events.on("written", (key) => written.push(key));

		drafts.write(newDraft("shop"), "hi");

		expect(written).toEqual(["new:shop"]);
	});
});
