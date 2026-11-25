import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { RigSlots } from "./slots";

const CAT = { word: "cat", emoji: "😸" };
const BEE = { word: "bee", emoji: "🐝" };
const POOL = [CAT, BEE];

describe("RigSlots", () => {
	it("hands out animals in pool order and keeps the same one across claims", async () => {
		const live = new Set(["/repo", "/trees/a"]);
		const slots = RigSlots.in(new MemoryStorage(), {
			exists: async (path) => live.has(path),
			pool: POOL,
		});

		expect(await slots.claim("vexml/dev@/repo", "/repo")).toEqual(CAT);
		expect(await slots.claim("vexml/dev@/trees/a", "/trees/a")).toEqual(BEE);
		// Claiming again returns the same animal.
		expect(await slots.claim("vexml/dev@/repo", "/repo")).toEqual(CAT);
		expect(await slots.claim("vexml/dev@/trees/a", "/trees/a")).toEqual(BEE);
	});

	it("reclaims a slot once its tree directory no longer exists", async () => {
		const live = new Set(["/repo", "/trees/a", "/trees/b"]);
		const slots = RigSlots.in(new MemoryStorage(), {
			exists: async (path) => live.has(path),
			pool: POOL,
		});

		expect(await slots.claim("vexml/dev@/repo", "/repo")).toEqual(CAT);
		expect(await slots.claim("vexml/dev@/trees/a", "/trees/a")).toEqual(BEE);

		live.delete("/trees/a");
		expect(await slots.claim("vexml/dev@/trees/b", "/trees/b")).toEqual(BEE);
	});

	it("refuses to claim when every animal is held by a live tree", async () => {
		const live = new Set(["/repo", "/trees/a", "/trees/b"]);
		const slots = RigSlots.in(new MemoryStorage(), {
			exists: async (path) => live.has(path),
			pool: POOL,
		});

		await slots.claim("vexml/dev@/repo", "/repo");
		await slots.claim("vexml/dev@/trees/a", "/trees/a");

		expect(slots.claim("vexml/dev@/trees/b", "/trees/b")).rejects.toThrow(
			"every rig slot is held:\n  cat: vexml/dev@/repo\n  bee: vexml/dev@/trees/a\nremove a worktree to free its slot",
		);
	});

	it("releases a claimed slot explicitly", async () => {
		const live = new Set(["/repo", "/trees/a"]);
		const slots = RigSlots.in(new MemoryStorage(), {
			exists: async (path) => live.has(path),
			pool: POOL,
		});

		await slots.claim("vexml/dev@/repo", "/repo");
		expect(await slots.release("vexml/dev@/repo")).toBe(true);
		expect(await slots.release("vexml/dev@/repo")).toBe(false);
		expect(await slots.claim("vexml/dev@/trees/a", "/trees/a")).toEqual(CAT);
	});

	it("skips words reserved by dev slots and reports live held words", async () => {
		const live = new Set(["/repo", "/trees/a"]);
		const reserved = new Set(["cat"]);
		const slots = RigSlots.in(new MemoryStorage(), {
			exists: async (path) => live.has(path),
			reserved: async () => reserved,
			pool: POOL,
		});

		expect(await slots.claim("vexml/dev@/repo", "/repo")).toEqual(BEE);
		expect([...(await slots.heldWords())]).toEqual(["bee"]);

		// If bee becomes reserved too, claiming again moves to cat once cat is free.
		reserved.delete("cat");
		reserved.add("bee");
		expect(await slots.claim("vexml/dev@/repo", "/repo")).toEqual(CAT);
	});
});
