import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { AgentSandbox } from "./sandbox";

describe("AgentSandbox.probe", () => {
	let home: string;
	let ps: FakePs;

	beforeEach(async () => {
		home = await realpath(await mkdtemp(`${tmpdir()}/sandbox-`));
		ps = new FakePs();
		ps.platform = "linux";
		ps.setEnv({ HOME: home, SPLATES_HOME: `${home}/.splates` });
	});

	afterEach(() => rm(home, { recursive: true, force: true }));

	it("sandboxes an agent's argv once a sandbox ran", async () => {
		const sandbox = await AgentSandbox.probe(ps, new FakeFs());
		expect(sandbox).toBeInstanceOf(AgentSandbox);
		expect(ps.getCalls()[0]).toStartWith("bwrap ");
		expect(ps.getCalls()[0]).toEndWith(`--chdir ${home} -- true`);
		// A home with no SSH keys has none to hide, and bubblewrap could not.
		expect(ps.getCalls()[0]).not.toContain(".ssh");
		const argv = (sandbox as AgentSandbox).wrap(["agent"], "/srv/repo");
		expect(argv[0]).toBe("bwrap");
		expect(argv.at(-1)).toBe("agent");
	});

	it("says why when bubblewrap cannot make a namespace", async () => {
		ps.simulate(async () => 1);
		ps.setCaptureOutput(
			"",
			"bwrap: No permissions to create a new namespace\n",
		);
		expect(await AgentSandbox.probe(ps, new FakeFs())).toBe(
			"bubblewrap cannot run here: bwrap: No permissions to create a new namespace",
		);
	});

	it("says it runs nowhere but Linux", async () => {
		ps.platform = "darwin";
		expect(await AgentSandbox.probe(ps, new FakeFs())).toBe(
			"agents run sandboxed only on Linux, not darwin",
		);
		expect(ps.getCalls()).toEqual([]);
	});
});
