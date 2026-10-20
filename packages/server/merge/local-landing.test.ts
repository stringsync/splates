import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "../tasks";
import { Testing } from "../testing";
import { landLocally } from "./local-landing";

describe("local landing", () => {
	let deps: Testing;
	let onto: string;
	let head: string;
	beforeEach(async () => {
		deps = await Testing.open();
		onto = await deps.git.head(deps.root);
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.commit(tree, "alpha.txt", "alpha\n", "add alpha");
		head = await deps.git.head(tree);
	});
	afterEach(async () => {
		await deps.disposeAsync();
	});

	it("compares and swaps without overwriting a moved base", async () => {
		await deps.commit(deps.root, "late.txt", "late\n", "move base");
		const latest = await deps.git.head(deps.root);
		const result = await landLocally({
			git: deps.git,
			base: "main",
			onto,
			head,
			landing: deps.root,
		});
		expect(result.moved).toBe(true);
		expect(await deps.git.head(deps.root)).toBe(latest);
		expect(await deps.fs.exists(join(deps.root, "alpha.txt"))).toBe(false);
	});

	it("preserves noncolliding edits in the base checkout", async () => {
		await deps.fs.write(join(deps.root, "README.md"), "local edit\n");
		expect(
			(
				await landLocally({
					git: deps.git,
					base: "main",
					onto,
					head,
					landing: deps.root,
				})
			).code,
		).toBe(0);
		expect(await deps.git.head(deps.root)).toBe(head);
		expect(await deps.fs.read(join(deps.root, "README.md"))).toBe(
			"local edit\n",
		);
		expect(await deps.fs.read(join(deps.root, "alpha.txt"))).toBe("alpha\n");
	});

	it("restores the base ref when checkout collides with an edit", async () => {
		await deps.fs.write(join(deps.root, "alpha.txt"), "local edit\n");
		expect(
			(
				await landLocally({
					git: deps.git,
					base: "main",
					onto,
					head,
					landing: deps.root,
				})
			).code,
		).not.toBe(0);
		expect(await deps.git.head(deps.root)).toBe(onto);
		expect(await deps.fs.read(join(deps.root, "alpha.txt"))).toBe(
			"local edit\n",
		);
	});
});
