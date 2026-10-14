import { describe, expect, it } from "bun:test";
import { MemoryLock } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { SLOT_POOL, Slots, slotOf } from "./slots";

describe("Slots", () => {
	const pool = [
		{ word: "cat", emoji: "😸" },
		{ word: "bee", emoji: "🐝" },
	];
	const machine = async () => {
		const fs = new FakeFs();
		await fs.mkdir("/trees/one");
		await fs.mkdir("/trees/two");
		await fs.mkdir("/trees/three");
		const slots = new Slots("/home/.arbor/slots.json", {
			fs,
			lock: new MemoryLock(),
			pool,
		});
		return { fs, slots };
	};

	it("gives each tree the first word no other holds, and the same one every time", async () => {
		const { slots } = await machine();

		expect(await slots.claim("/trees/one")).toEqual({
			word: "cat",
			emoji: "😸",
		});
		expect(await slots.claim("/trees/two")).toEqual({
			word: "bee",
			emoji: "🐝",
		});
		expect((await slots.claim("/trees/one")).word).toBe("cat");
		expect((await slots.claim("/trees/two")).word).toBe("bee");
	});

	it("takes a word back from a tree that no longer exists", async () => {
		const { fs, slots } = await machine();
		await slots.claim("/trees/one");
		await slots.claim("/trees/two");
		await fs.rm("/trees/one", { recursive: true });

		expect((await slots.claim("/trees/three")).word).toBe("cat");
	});

	it("names every holder when every word is held", async () => {
		const { slots } = await machine();
		await slots.claim("/trees/one");
		await slots.claim("/trees/two");

		await expect(slots.claim("/trees/three")).rejects.toThrow(
			"every dev slot is held:\n  cat: /trees/one\n  bee: /trees/two",
		);
	});

	it("hands out short animals, each once", () => {
		const words = SLOT_POOL.map(({ word }) => word);
		expect(words.every((word) => word.length === 3 || word.length === 4)).toBe(
			true,
		);
		expect(new Set(words).size).toBe(words.length);
		expect(slotOf("fox")?.emoji).toBe("🦊");
		expect(slotOf("yak")).toBeNull();
	});
});
