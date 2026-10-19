import { beforeEach, describe, expect, it } from "bun:test";
import { Drafts } from "./drafts";
import { FakeDraftFiles } from "./fake-draft-files";

/** A storage that keeps what it is given, as `localStorage` does. */
function keeping(): Storage {
	const items = new Map<string, string>();
	return {
		get length() {
			return items.size;
		},
		key: (i: number) => [...items.keys()][i] ?? null,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => items.set(key, value),
		removeItem: (key: string) => items.delete(key),
		clear: () => items.clear(),
	};
}

describe("Drafts across a reload", () => {
	let storage: Storage;
	let kept: FakeDraftFiles;
	const shot = new File(["png"], "shot.png", { type: "image/png" });

	beforeEach(() => {
		storage = keeping();
		kept = new FakeDraftFiles();
		const before = new Drafts(storage, kept);
		before.write("c1", "look [Image 1] ");
		before.attach("c1", [shot]);
	});

	it("gives a draft's files back, saying it was written", async () => {
		const after = new Drafts(storage, kept);
		const written: string[] = [];
		after.events.on("written", (key) => written.push(key));
		await Bun.sleep(0);

		expect(after.files("c1")).toEqual([shot]);
		expect(written).toEqual(["c1"]);
	});

	it("lets go of the files of a draft sent", async () => {
		new Drafts(storage, kept).write("c1", "");

		const after = new Drafts(storage, kept);
		await Bun.sleep(0);

		expect(after.files("c1")).toEqual([]);
		expect(kept.kept).toEqual(new Map());
	});

	it("lets go of the files of a draft whose words storage lost", async () => {
		storage.removeItem("splates.draft.c1");

		const after = new Drafts(storage, kept);
		await Bun.sleep(0);

		expect(after.files("c1")).toEqual([]);
		expect(kept.kept).toEqual(new Map());
	});

	it("keeps files attached again before the kept ones came back", async () => {
		const clip = new File(["mp4"], "clip.mp4", { type: "video/mp4" });
		const after = new Drafts(storage, kept);
		after.attach("c1", [clip]);
		await Bun.sleep(0);

		expect(after.files("c1")).toEqual([clip]);
		expect(kept.kept).toEqual(new Map([["c1", [clip]]]));
	});
});
