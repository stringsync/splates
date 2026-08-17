import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { Git } from "./git";
import { loadConfig } from "./load-config";
import { repo } from "./testing";

describe("loadConfig", () => {
	const fs = new NodeFs();
	let root: string;
	let git: Git;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "arbor-config-"));
		const ps = new FakePs();
		// Stands in for a repo with no `origin/HEAD` to read.
		ps.simulate(() => Promise.resolve(1));
		git = new Git(root, { ps });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("defaults the worktree root to a sibling of the repo, named after it", async () => {
		const config = await loadConfig(root, { fs, git });

		expect(config.worktreeRoot).toBe(`${root}-arbor`);
	});

	it("leaves every hook unset, so a repo runs only what it asks for", async () => {
		const config = await loadConfig(root, { fs, git });

		expect(config.postCheckout).toBeNull();
		expect(config.postRewrite).toBeNull();
		expect(config.preMerge).toBeNull();
	});

	it("overrides only the defaults arbor.config.ts names", async () => {
		await fs.write(
			join(root, "arbor.config.ts"),
			`export default { trunk: "trunk", mergeRetryCount: 7 };\n`,
		);

		const config = await loadConfig(root, { fs, git });

		expect(config.trunk).toBe("trunk");
		expect(config.mergeRetryCount).toBe(7);
		expect(config.leaseStalenessMs).toBe(90_000);
	});

	it("falls back to main when the repo has no origin/HEAD", async () => {
		const config = await loadConfig(root, { fs, git });

		expect(config.trunk).toBe("main");
	});

	it("reports the config path and the remedy when the file will not import", async () => {
		await fs.write(
			join(root, "arbor.config.ts"),
			`import "./nowhere-at-all";\nexport default {};\n`,
		);

		const failure = await loadConfig(root, { fs, git }).catch(
			(entry: Error) => entry,
		);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain("arbor.config.ts");
		expect((failure as Error).message).toContain("bun install");
	});

	it("takes the trunk from what origin/HEAD points at", async () => {
		await using fixture = await repo();
		await originHead(fixture, "master");

		const config = await loadConfig(fixture.root, {
			fs,
			git: new Git(fixture.root, { ps: fixture.ps }),
		});

		expect(config.trunk).toBe("master");
	});

	it("prefers the trunk arbor.config.ts names over what it detects", async () => {
		await using fixture = await repo();
		await originHead(fixture, "master");
		await fixture.fs.write(
			join(fixture.root, "arbor.config.ts"),
			`export default { trunk: "release" };\n`,
		);

		const config = await loadConfig(fixture.root, {
			fs,
			git: new Git(fixture.root, { ps: fixture.ps }),
		});

		expect(config.trunk).toBe("release");
	});
});

/** Fabricates the ref a clone would fetch, without a remote to fetch from. */
async function originHead(
	fixture: Awaited<ReturnType<typeof repo>>,
	branch: string,
): Promise<void> {
	await fixture.gitCli(
		fixture.root,
		"remote",
		"add",
		"origin",
		"https://example.invalid/repo.git",
	);
	await fixture.gitCli(
		fixture.root,
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		`refs/remotes/origin/${branch}`,
	);
}
