import { describe, expect, it } from "bun:test";
import { MemoryLock } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { SERVER_PID, SLOT_POOL, Slots, slotOf } from "./slots";

describe("Slots", () => {
	const pool = [
		{ word: "cat", emoji: "😸" },
		{ word: "bee", emoji: "🐝" },
	];
	const machine = async () => {
		const fs = new FakeFs();
		const ps = new FakePs();
		await fs.mkdir("/trees/one");
		await fs.mkdir("/trees/two");
		await fs.mkdir("/trees/three");
		const slots = new Slots("/home/.arbor/slots.json", {
			fs,
			ps,
			lock: new MemoryLock(),
			pool,
		});
		// Leaves a server running on `word`, as `arbor dev --slot` does, which
		// a SIGTERM ends.
		const serve = async (word: string, pid: number) => {
			await fs.mkdir(`/home/.arbor/slots/${word}`);
			await fs.write(`/home/.arbor/slots/${word}/${SERVER_PID}`, String(pid));
			ps.setProcesses([
				{
					pid,
					ppid: 1,
					pgid: pid,
					tpgid: 0,
					command: "bun index.ts dev --slot",
				},
			]);
			ps.simulate(async () => {
				const [, killed] = ps.getCalls().at(-1)?.split(" ") ?? [];
				ps.kill(Number(killed));
				return 0;
			});
		};
		// An arbor repository's main tree, which every agent of it shares.
		const main = async (tree: string) => {
			await fs.mkdir(`${tree}/.git/arbor`);
		};
		return { fs, ps, slots, serve, main };
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

	it("keeps a word whose server still runs after its tree is gone", async () => {
		const { fs, slots, serve } = await machine();
		await slots.claim("/trees/one");
		await serve("cat", 777);
		await fs.rm("/trees/one", { recursive: true });

		expect((await slots.claim("/trees/two")).word).toBe("bee");
		await expect(slots.claim("/trees/three")).rejects.toThrow(
			"every dev slot is held:\n  cat: pid 777, run from /trees/one\n  bee: /trees/two",
		);
	});

	it("takes a word back once its server stops", async () => {
		const { fs, ps, slots, serve } = await machine();
		await slots.claim("/trees/one");
		await serve("cat", 777);
		await fs.rm("/trees/one", { recursive: true });
		ps.kill(777);

		expect((await slots.claim("/trees/two")).word).toBe("cat");
	});

	it("takes a word back whose pid has gone to another program", async () => {
		const { fs, ps, slots, serve } = await machine();
		await slots.claim("/trees/one");
		await serve("cat", 777);
		await fs.rm("/trees/one", { recursive: true });
		ps.setProcesses([
			{ pid: 777, ppid: 1, pgid: 777, tpgid: 0, command: "vim notes.txt" },
		]);

		expect((await slots.claim("/trees/two")).word).toBe("cat");
	});

	it("takes a word back from an arbor repository's main tree", async () => {
		const { slots, main } = await machine();
		await slots.claim("/trees/one");
		await main("/trees/one");

		expect(await slots.owns("/trees/one")).toBe(false);
		expect((await slots.claim("/trees/two")).word).toBe("cat");
	});

	it("gives a tree's word back and stops its server on release", async () => {
		const { ps, slots, serve } = await machine();
		await slots.claim("/trees/one");
		await serve("cat", 777);

		expect(await slots.release("/trees/one")).toEqual({
			slot: { word: "cat", emoji: "😸" },
			stopped: 777,
		});
		expect(ps.alive(777)).toBe(false);
		expect(await slots.release("/trees/one")).toBeNull();
		expect((await slots.claim("/trees/two")).word).toBe("cat");
	});

	it("prunes only the orphans, stopping their servers", async () => {
		const { fs, ps, slots, serve, main } = await machine();
		await slots.claim("/trees/one");
		await slots.claim("/trees/two");
		await serve("cat", 777);
		await fs.rm("/trees/one", { recursive: true });
		await main("/trees/two");

		expect(
			(await slots.prune()).map(({ slot, pid }) => [slot.word, pid]),
		).toEqual([
			["cat", 777],
			["bee", null],
		]);
		expect(ps.alive(777)).toBe(false);
		expect(await slots.status()).toEqual([]);
	});

	it("leaves a task's worktree its word and its running server on prune", async () => {
		const { ps, slots, serve } = await machine();
		await slots.claim("/trees/one");
		await serve("cat", 777);

		expect(await slots.prune()).toEqual([]);
		expect(ps.alive(777)).toBe(true);
		expect(await slots.status()).toEqual([
			{
				slot: { word: "cat", emoji: "😸" },
				tree: "/trees/one",
				pid: 777,
				orphaned: false,
			},
		]);
	});

	it("names every holder when every word is held", async () => {
		const { slots } = await machine();
		await slots.claim("/trees/one");
		await slots.claim("/trees/two");

		await expect(slots.claim("/trees/three")).rejects.toThrow(
			"every dev slot is held:\n  cat: /trees/one\n  bee: /trees/two",
		);
	});

	it("lists each word a tree that still exists holds, in the pool's order", async () => {
		const { fs, slots } = await machine();
		await slots.claim("/trees/one");
		await slots.claim("/trees/two");

		expect(await slots.list()).toEqual([
			{ slot: { word: "cat", emoji: "😸" }, tree: "/trees/one" },
			{ slot: { word: "bee", emoji: "🐝" }, tree: "/trees/two" },
		]);
		await fs.rm("/trees/one", { recursive: true });
		expect((await slots.list()).map(({ tree }) => tree)).toEqual([
			"/trees/two",
		]);
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
