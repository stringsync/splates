import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
import { add } from "./add";
import { attach } from "./attach";
import { merge } from "./merge";
import { remove } from "./remove";
import { Testing } from "./testing";

describe("attach", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	/** A file the agent took somewhere outside arbor, as a screenshot would be. */
	const taken = async (name: string, bytes = 1): Promise<string> => {
		const path = join(deps.root, "..", name);
		await deps.fs.writeBytes(path, new Uint8Array(bytes));
		return path;
	};

	it("stores files beside the task's record, printing where", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;

		const [stored = ""] = await attach(deps, [await taken("shot.png")], tree);

		expect(deps.service.owns(stored)).toBe(true);
		expect(stored).toEndWith("-shot.png");
		expect(deps.out()).toContain(stored);
		expect(await deps.fs.exists(stored)).toBe(true);
	});

	it("drops a file by its stored name before storing more", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		const [old = ""] = await attach(deps, [await taken("old.png")], tree);

		await attach(deps, [await taken("new.png")], tree, {
			remove: [basename(old)],
		});

		const held = await deps.service.files("alpha").held();
		expect(held.map((file) => file.path)).toEqual([
			expect.stringMatching(/-new\.png$/),
		]);
		await expect(attach(deps, [], tree, { remove: ["gone.png"] })).toBail(
			"not_found",
			{ data: { task: "alpha", file: "gone.png" } },
		);
	});

	it("refuses to take a task past its capacity, storing nothing", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		deps.config.attachmentCapacity = 10;
		await attach(deps, [await taken("a.png", 6)], tree);

		await expect(attach(deps, [await taken("b.webm", 6)], tree)).toBail(
			"too_large",
			{ data: { task: "alpha", bytes: 12, capacity: 10 } },
		);
		expect(await deps.service.files("alpha").held()).toHaveLength(1);
	});

	it("needs a task", async () => {
		await expect(attach(deps, [await taken("a.png")], deps.root)).toBail(
			"usage",
			{ message: "--task" },
		);
		await expect(
			attach(deps, [await taken("a.png")], deps.root, { task: "nope" }),
		).toBail("not_found");
	});

	it("goes with the task when it is removed", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		const [stored = ""] = await attach(deps, [await taken("a.png")], tree);

		await remove(deps, "alpha");

		expect(await deps.fs.exists(stored)).toBe(false);
	});

	it("goes with the task when it merges", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		const [stored = ""] = await attach(deps, [await taken("a.png")], tree);
		await deps.commit(tree, "a.txt", "a\n", "add a");
		await deps.finish(tree);

		await merge(deps, tree);

		expect(await deps.fs.exists(stored)).toBe(false);
	});

	it("leaves nothing behind a task that died before its files went", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		const [stored = ""] = await attach(deps, [await taken("a.png")], tree);
		await deps.fs.rm(deps.service.recordPath("alpha"));

		await deps.service.init();

		expect(await deps.fs.exists(stored)).toBe(false);
	});

	describe("from a conversation", () => {
		const ID = "c1";

		beforeEach(async () => {
			await deps.fs.mkdir(`${deps.arborDir}/conversations`);
			await deps.fs.writeBytes(
				`${deps.arborDir}/conversations/${ID}.jsonl`,
				new Uint8Array(),
			);
		});

		it("keeps files in its folder, served and listed like any", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;

			const [stored = ""] = await attach(deps, [await taken("a.png")], tree, {
				conversation: ID,
			});

			expect(stored).toContain(`/conversations/${ID}/attached/alpha/`);
			expect(deps.service.owns(stored)).toBe(true);
			expect(
				deps.service.owns(`${deps.arborDir}/conversations/${ID}.jsonl`),
			).toBe(false);
			expect(
				deps.service.owns(`${deps.arborDir}/conversations/${ID}/artifacts/x`),
			).toBe(false);
			await attach(deps, [], tree);
			expect(deps.out()).toContain("holds 1 file");
			await attach(deps, [], tree, { remove: [basename(stored)] });
			expect(await deps.fs.exists(stored)).toBe(false);
		});

		it("survives the task's merge and removal", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;
			const [stored = ""] = await attach(deps, [await taken("a.png")], tree, {
				conversation: ID,
			});
			await deps.commit(tree, "a.txt", "a\n", "add a");
			await deps.finish(tree);

			await merge(deps, tree);

			expect(await deps.fs.exists(stored)).toBe(true);
		});

		it("counts toward the conversation's capacity", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;
			deps.config.artifactConversationCapacity = 10;
			await attach(deps, [await taken("a.png", 6)], tree, { conversation: ID });

			await expect(
				attach(deps, [await taken("b.png", 6)], tree, { conversation: ID }),
			).toBail("too_large", {
				data: { conversation: ID, bytes: 12, capacity: 10 },
			});
		});

		it("refuses a conversation this project lacks", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;

			await expect(
				attach(deps, [await taken("a.png")], tree, { conversation: "nope" }),
			).toBail("not_found");
		});
	});
});
