import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FsStorage } from "../storage";
import { type Member, MergeBatch } from "./batch";

describe("MergeBatch", () => {
	let fs: FakeFs;
	let ps: FakePs;
	let log: MemoryLogger;
	let batch: MergeBatch;
	/** A follower of `task` that answers each invitation with `head`, until stopped. */
	let following: (
		task: string,
		head: (onto: string) => string | null,
	) => { stop: () => Promise<void> };

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new FakePs();
		log = new MemoryLogger();
		batch = new MergeBatch(
			new FsStorage("/project/.git/splates", fs),
			ps,
			log,
			{
				pollMs: 5,
				replyMs: 200,
			},
		);
		following = (task, head) => {
			let done = false;
			const loop = (async () => {
				while (!done) {
					const invite = await batch.invited(task);
					if (invite !== null) {
						await batch.stacked(task, invite.onto, head(invite.onto));
					}
					await Bun.sleep(5);
				}
			})();
			return {
				stop: async () => {
					done = true;
					await loop;
				},
			};
		};
	});

	it("invites the merges waiting on its base oldest first, each onto the one before, up to the cap", async () => {
		await batch.offer("delta", "main");
		await Bun.sleep(2);
		await batch.offer("beta", "main");
		await Bun.sleep(2);
		await batch.offer("gamma", "main");
		await batch.offer("other", "feature/x");
		await Bun.sleep(2);
		await batch.offer("epsilon", "main");
		const followers = ["beta", "gamma", "delta", "epsilon"].map((task) =>
			following(task, (onto) => `${task}-on-${onto}`),
		);

		const members = await batch.form("alpha", "main", "tip");
		await Promise.all(followers.map((each) => each.stop()));

		expect(members).toEqual([
			{ task: "delta", onto: "tip", head: "delta-on-tip" },
			{ task: "beta", onto: "delta-on-tip", head: "beta-on-delta-on-tip" },
			{
				task: "gamma",
				onto: "beta-on-delta-on-tip",
				head: "gamma-on-beta-on-delta-on-tip",
			},
		] satisfies Member[]);
		expect(await batch.invited("epsilon")).toBeNull();
	});

	it("leaves out a follower that declines or does not answer, and does not ask it again", async () => {
		await batch.offer("beta", "main");
		await Bun.sleep(2);
		await batch.offer("gamma", "main");
		await Bun.sleep(2);
		await batch.offer("delta", "main");
		const beta = following("beta", () => null);
		const delta = following("delta", (onto) => `delta-on-${onto}`);

		const first = await batch.form("alpha", "main", "tip");
		const again = await batch.form("alpha", "main", "tip2");
		await Promise.all([beta.stop(), delta.stop()]);

		expect(first).toEqual([
			{ task: "delta", onto: "tip", head: "delta-on-tip" },
		]);
		expect(again).toEqual([
			{ task: "delta", onto: "tip2", head: "delta-on-tip2" },
		]);
		expect(log.entries.map((entry) => entry.message)).toEqual([
			expect.stringContaining("gamma did not stack"),
		]);
	});

	it("drops the offer of a merge whose process is gone", async () => {
		await batch.offer("beta", "main");
		const records = new FsStorage("/project/.git/splates", fs).collection(
			"merge-batch",
		);
		await records.write(
			"offer:ghost",
			JSON.stringify({
				task: "ghost",
				pid: 99,
				hostname: ps.hostname,
				base: "main",
				since: "2026-01-01T00:00:00.000Z",
			}),
		);
		ps.kill(99);
		const beta = following("beta", (onto) => `beta-on-${onto}`);

		const members = await batch.form("alpha", "main", "tip");
		await beta.stop();

		expect(members.map((each) => each.task)).toEqual(["beta"]);
		expect(await records.read("offer:ghost")).toBeNull();
	});

	it("tells a follower its result, which clearing it removes with the rest", async () => {
		await batch.offer("beta", "main");
		const member = { task: "beta", onto: "tip", head: "beta-head" };

		await batch.tell(member, {
			kind: "landed",
			head: "beta-head",
			batch: ["alpha", "beta"],
		});
		expect(await batch.result("beta")).toEqual({
			kind: "landed",
			head: "beta-head",
			batch: ["alpha", "beta"],
		});

		await batch.clear("beta");
		expect(await batch.result("beta")).toBeNull();
		expect(await batch.form("alpha", "main", "tip")).toEqual([]);
	});
});
