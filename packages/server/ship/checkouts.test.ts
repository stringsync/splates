import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Testing } from "../testing";
import { GitRunCheckouts } from "./checkouts";

describe("GitRunCheckouts", () => {
	let env: Testing;

	beforeEach(async () => {
		env = await Testing.open();
	});

	afterEach(() => env.disposeAsync());

	function checkouts(postCheckout: string | null = "touch readied") {
		return new GitRunCheckouts(
			env.git,
			env.ps,
			env.fs,
			env.config.worktreeRoot,
			postCheckout,
		);
	}

	async function commit(file: string, text: string): Promise<string> {
		await writeFile(join(env.root, file), text);
		await env.gitCli(env.root, "add", file);
		await env.gitCli(env.root, "commit", "-qm", file);
		return (await env.gitCli(env.root, "rev-parse", "HEAD")).trim();
	}

	it("keeps a run's checkout on its start commit while main moves, readied once, and removes it", async () => {
		const made = checkouts();
		const start = await made.head();
		const path = await made.ready("r1", start);
		expect(await env.fs.exists(join(path, "readied"))).toBe(true);
		await commit("later.txt", "later");
		expect(await made.ready("r1", start)).toBe(path);
		expect((await env.gitCli(path, "rev-parse", "HEAD")).trim()).toBe(start);
		expect(await env.fs.exists(join(path, "later.txt"))).toBe(false);
		await made.release("r1");
		expect(await env.fs.exists(path)).toBe(false);
		await made.release("r1");
	});

	it("takes in only the fix's commit, not what landed before it", async () => {
		const made = checkouts(null);
		const start = await made.head();
		await made.ready("r1", start);
		await commit("other.txt", "other");
		const fix = await commit("fix.txt", "fixed");
		const after = await made.apply("r1", start, fix);
		const path = made.path("r1");
		expect((await env.gitCli(path, "rev-parse", "HEAD")).trim()).toBe(after);
		expect(await readFile(join(path, "fix.txt"), "utf8")).toBe("fixed");
		expect(await env.fs.exists(join(path, "other.txt"))).toBe(false);
	});

	it("refuses a fix that will not apply, leaving the checkout as it was", async () => {
		const made = checkouts(null);
		await commit("a.txt", "one");
		const start = await made.head();
		await made.ready("r1", start);
		await commit("a.txt", "two");
		await env.gitCli(env.root, "rm", "-q", "a.txt");
		await env.gitCli(env.root, "commit", "-qm", "drop a");
		await commit("a.txt", "three");
		const fix = (await env.gitCli(env.root, "rev-parse", "HEAD")).trim();
		expect(made.apply("r1", start, fix)).rejects.toThrow();
		const path = made.path("r1");
		expect((await env.gitCli(path, "status", "--porcelain")).trim()).toBe("");
		expect((await env.gitCli(path, "rev-parse", "HEAD")).trim()).toBe(start);
	});

	it("fails to ready a checkout whose postCheckout fails, leaving none", async () => {
		const made = checkouts("exit 3");
		const start = await made.head();
		expect(made.ready("r1", start)).rejects.toThrow("exited 3");
		expect(await env.fs.exists(made.path("r1"))).toBe(false);
	});
});
