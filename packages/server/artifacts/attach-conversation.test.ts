import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
import { merge } from "../merge";
import { add } from "../tasks";
import { Testing } from "../testing";
import { attach } from "./attach";

describe("attach from a conversation", () => {
	let deps: Testing;
	const ID = "c1";

	beforeEach(async () => {
		deps = await Testing.open();
		await deps.fs.mkdir(`${deps.splatesDir}/conversations`);
		await deps.fs.writeBytes(
			`${deps.splatesDir}/conversations/${ID}.jsonl`,
			new Uint8Array(),
		);
	});

	afterEach(() => deps.disposeAsync());

	/** A file the agent took somewhere outside splates, as a screenshot would be. */
	const taken = async (name: string, bytes = 1): Promise<string> => {
		const path = join(deps.root, "..", name);
		await deps.fs.writeBytes(path, new Uint8Array(bytes));
		return path;
	};

	it("keeps files in its folder, served and listed like any", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;

		const [stored = ""] = await attach(deps, [await taken("a.png")], tree, {
			conversation: ID,
		});

		expect(stored).toContain(`/conversations/${ID}/attached/alpha/`);
		expect(deps.service.owns(stored)).toBe(true);
		expect(
			deps.service.owns(`${deps.splatesDir}/conversations/${ID}.jsonl`),
		).toBe(false);
		expect(
			deps.service.owns(`${deps.splatesDir}/conversations/${ID}/artifacts/x`),
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
