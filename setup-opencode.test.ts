import { beforeEach, describe, expect, it } from "bun:test";
import type { SpawnOptions, StartOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { eventually } from "./conversation-testing";
import { OpenCodeSetup } from "./setup-opencode";

describe("OpenCode setup checks", () => {
	let ps: OpenCodePs;
	let fs: FakeFs;
	let setup: OpenCodeSetup;
	beforeEach(() => {
		ps = new OpenCodePs();
		fs = new FakeFs();
		setup = new OpenCodeSetup({ ps, fs, home: "/arbor" });
	});

	it("does nothing until explicitly checked, then negotiates only initialize", async () => {
		expect(setup.read().checkedAt).toBeNull();
		expect(ps.getCalls()).toEqual([]);
		const result = await setup.check();
		expect(result).toMatchObject({
			version: "2.0.0-fixture",
			auth: "stored",
			protocol: "compatible",
			problem: null,
			checking: false,
		});
		expect(ps.requests).toEqual(["initialize"]);
		expect(ps.getChildren()[0]?.signals).toEqual(["SIGTERM"]);
		expect(ps.getCallDirs()).toEqual(Array(5).fill("/arbor/setup-opencode"));
		expect(await fs.exists("/arbor/agents.json")).toBe(false);
	});

	it("invalidates authentication observations when a native action begins", async () => {
		await setup.check();
		setup.invalidate();
		expect(setup.read()).toMatchObject({
			auth: "unchecked",
			protocol: "unchecked",
			checkedAt: null,
		});
		expect((await setup.check()).auth).toBe("stored");
	});

	it("does not confuse other providers or environment credentials with a stored Go login", async () => {
		ps.auth = JSON.stringify([
			{ id: "opencode", connections: [{ type: "credential" }] },
			{ id: "opencode-go", connections: [{ type: "environment" }] },
		]);
		expect((await setup.check()).auth).toBe("missing");
	});

	it("reports missing installation without reflecting command output", async () => {
		ps.version = "error containing a secret";
		const result = await setup.check();
		expect(result.version).toBeNull();
		expect(result.problem).toContain("not found");
		expect(JSON.stringify(result)).not.toContain("secret");
		expect(ps.getCalls()).toEqual(["opencode --version"]);
	});

	it("refuses legacy login interfaces rather than guessing a key input flow", async () => {
		ps.loginHelp = "auth login --provider";
		expect((await setup.check()).auth).toBe("unsupported");
		expect(ps.getChildren()).toEqual([]);
	});

	it("treats malformed auth metadata as a failure, not a successful login", async () => {
		ps.auth = '{"key":"never display"}';
		const result = await setup.check();
		expect(result.auth).toBe("unsupported");
		expect(result.problem).toContain("could not list");
		expect(JSON.stringify(result)).not.toContain("never display");
	});

	it("reports a protocol mismatch and allows a clean retry", async () => {
		ps.protocol = 99;
		expect((await setup.check()).protocol).toBe("failed");
		ps.protocol = 1;
		expect((await setup.check()).protocol).toBe("compatible");
		expect(ps.requests).toEqual(["initialize", "initialize"]);
	});

	it("coalesces concurrent checks, cancels a stuck handshake and releases its process", async () => {
		ps.hang = true;
		const first = setup.check();
		expect(setup.check()).toBe(first);
		await eventually(() => ps.requests.length > 0);
		setup.cancel();
		expect((await first).problem).toContain("canceled");
		expect(ps.getChildren()[0]?.signals).toEqual(["SIGTERM"]);
		ps.hang = false;
		expect((await setup.check()).problem).toBeNull();
	});
});

/** Synthetic CLI metadata and initialize response, never a production account. */
class OpenCodePs extends FakePs {
	version = "2.0.0-fixture";
	auth = JSON.stringify([
		{
			id: "opencode-go",
			connections: [{ type: "credential", label: "fixture" }],
		},
	]);
	loginHelp = "auth login [target] --method --standalone";
	protocol = 1;
	hang = false;
	requests: string[] = [];
	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		const cmd = argv.slice(1).join(" ");
		return {
			exitCode: 0,
			stderr: "private diagnostic never returned",
			stdout:
				cmd === "--version"
					? this.version
					: cmd === "auth login --help"
						? this.loginHelp
						: cmd === "auth list --help"
							? "--format json --standalone"
							: this.auth,
		};
	}
	override start(argv: string[], opts?: StartOptions) {
		const child = super.start(argv, opts);
		void (async () => {
			for await (const bytes of child.received) {
				const message = JSON.parse(new TextDecoder().decode(bytes));
				this.requests.push(message.method);
				if (!this.hang) {
					child.print(
						`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: this.protocol, agentCapabilities: {}, authMethods: [] } })}\n`,
					);
				}
			}
		})();
		return child;
	}
}
