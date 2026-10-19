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

	it("moves a draft after what the other key holds", () => {
		const drafts = new Drafts(refusing);
		drafts.write("new:", "fix the login");
		drafts.write("new:shop", "and the footer");

		drafts.move("new:", "new:shop");

		expect(drafts.read("new:")).toBe("");
		expect(drafts.read("new:shop")).toBe("and the footer\n\nfix the login");
	});

	it("says which draft was written", () => {
		const drafts = new Drafts(refusing);
		const written: string[] = [];
		drafts.events.on("written", (key) => written.push(key));

		drafts.write(newDraft("shop"), "hi");

		expect(written).toEqual(["new:shop"]);
	});

	it("says whether any draft holds text", () => {
		const drafts = new Drafts(refusing);
		expect(drafts.typed()).toBe(false);

		drafts.write("c1", "typing");
		expect(drafts.typed()).toBe(true);

		drafts.write("c1", "");
		expect(drafts.typed()).toBe(false);
	});

	it("lists a project's unstarted drafts that hold words or files, the main tree's first", () => {
		const drafts = new Drafts(refusing);
		const shot = new File(["png"], "shot.png", { type: "image/png" });
		drafts.write(newDraft("shop", "fix-upload"), "in the task");
		drafts.attach(newDraft("shop"), [shot]);
		drafts.write(newDraft("shopfront"), "another project");
		drafts.write("c1", "a conversation's");

		expect(drafts.unstarted("shop")).toEqual([
			newDraft("shop"),
			newDraft("shop", "fix-upload"),
		]);
		drafts.discard(newDraft("shop"));
		expect(drafts.unstarted("shop")).toEqual([newDraft("shop", "fix-upload")]);
	});

	it("lists an opened unstarted conversation left empty only when asked, until it starts or is thrown away", () => {
		const drafts = new Drafts(refusing);
		drafts.open(newDraft("shop"));
		drafts.open(newDraft("shop", "fix-upload"));

		expect(drafts.unstarted("shop")).toEqual([]);
		expect(drafts.unstarted("shop", true)).toEqual([
			newDraft("shop"),
			newDraft("shop", "fix-upload"),
		]);
		drafts.started(newDraft("shop"));
		drafts.discard(newDraft("shop", "fix-upload"));
		expect(drafts.unstarted("shop", true)).toEqual([]);
	});

	it("moves a draft's files with its words, and keeps where it was written", () => {
		const drafts = new Drafts(refusing);
		const shot = new File(["png"], "shot.png", { type: "image/png" });
		drafts.attach("new:", [shot]);
		drafts.place("new:", "new/codex");

		drafts.move("new:", "new:shop");

		expect(drafts.files("new:shop")).toEqual([shot]);
		expect(drafts.holds("new:")).toBe(false);
		expect(drafts.placeOf("new:")).toBe("new/codex");
	});
});
