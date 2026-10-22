import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { CloudWorkers } from "../cloud";
import { Git } from "../git";
import { Testing } from "../testing";
import { loadConfig } from "./load";

describe("loadConfig", () => {
	const fs = new NodeFs();
	let root: string;
	let git: Git;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "splates-config-"));
		const ps = new FakePs();
		// Stands in for a repo with no `origin/HEAD` to read.
		ps.simulate(() => Promise.resolve(1));
		git = new Git(root, { ps });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("defaults the worktree root to a sibling of the repo, named after it, that Spotlight skips", async () => {
		const config = await loadConfig(root, { fs, git });

		expect(config.worktreeRoot).toBe(`${root}-splates.noindex`);
		expect(config.notesDir).toBe("notes");
	});

	it("leaves every hook unset, so a repo runs only what it asks for", async () => {
		const config = await loadConfig(root, { fs, git });

		expect(config.postCheckout).toBeNull();
		expect(config.postRewrite).toBeNull();
		expect(config.preMerge).toBeNull();
	});

	it("overrides only the defaults splates.config.ts names", async () => {
		await fs.write(
			join(root, "splates.config.ts"),
			`export default { trunk: "trunk", mergeRetryCount: 7, notesDir: "docs/context" };\n`,
		);

		const config = await loadConfig(root, { fs, git });

		expect(config.trunk).toBe("trunk");
		expect(config.mergeRetryCount).toBe(7);
		expect(config.notesDir).toBe("docs/context");
		expect(config.leaseStalenessMs).toBe(90_000);
	});

	it("makes runners in the cloud splates.config.ts names, unless it names a provider too", async () => {
		const cloud = `{ name: "Some Cloud", defaults: { workerLocations: [] } }`;
		await fs.write(
			join(root, "splates.config.ts"),
			`export default { cloud: ${cloud} };\n`,
		);
		expect((await loadConfig(root, { fs, git })).workerProvider).toBeInstanceOf(
			CloudWorkers,
		);

		await fs.write(
			join(root, "splates.config.ts"),
			`export default { cloud: ${cloud}, workerProvider: { own: true } };\n`,
		);
		expect((await loadConfig(root, { fs, git })).workerProvider).toEqual({
			own: true,
		} as never);
	});

	it("makes no workers without a provider", async () => {
		const config = await loadConfig(root, { fs, git });

		expect(config.workerProvider).toBeNull();
	});

	it("reads todoStalenessMs, from before todos became tasks, as taskStalenessMs", async () => {
		await fs.write(
			join(root, "splates.config.ts"),
			`export default { todoStalenessMs: 1000 };\n`,
		);

		const config = await loadConfig(root, { fs, git });

		expect(config.taskStalenessMs).toBe(1000);
		expect("todoStalenessMs" in config).toBe(false);
	});

	it("falls back to main when the repo has no origin/HEAD", async () => {
		const config = await loadConfig(root, { fs, git });

		expect(config.trunk).toBe("main");
	});

	it("reports the config path and the remedy when the file will not import", async () => {
		await fs.write(
			join(root, "splates.config.ts"),
			`import "./nowhere-at-all";\nexport default {};\n`,
		);

		const failure = await loadConfig(root, { fs, git }).catch(
			(entry: Error) => entry,
		);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain("splates.config.ts");
		expect((failure as Error).message).toContain("bun install");
	});

	it("takes the trunk from what origin/HEAD points at", async () => {
		await using fixture = await Testing.open();
		await originHead(fixture, "master");

		const config = await loadConfig(fixture.root, {
			fs,
			git: new Git(fixture.root, { ps: fixture.ps }),
		});

		expect(config.trunk).toBe("master");
	});

	it("prefers the trunk splates.config.ts names over what it detects", async () => {
		await using fixture = await Testing.open();
		await originHead(fixture, "master");
		await fixture.fs.write(
			join(fixture.root, "splates.config.ts"),
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
async function originHead(fixture: Testing, branch: string): Promise<void> {
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
