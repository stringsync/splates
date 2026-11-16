import { describe, expect, it } from "bun:test";
import type { SpawnCaptureResult, SpawnOptions } from "core/system";
import { FakeFs, FakePs } from "core/system/testing";
import { NoopLogger } from "../noop-logger";
import {
	type CommandPlan,
	type CommandStatus,
	ShipCommandClient,
} from "./command-client";
import { registeredGraph } from "./commands";
import { ShipLive } from "./live";

describe("ship command contract", () => {
	it("reads the script identity and status in the main tree with a bounded timeout", async () => {
		const ps = new ScriptPs();
		const client = new ShipCommandClient(ps, new NoopLogger());
		expect(await client.plan(project)).toEqual(plan);
		expect(await client.status(project)).toEqual(status);
		expect(ps.commands.map((each) => each.argv)).toEqual([
			["sh", "-c", "bin/app ship plan --json"],
			["sh", "-c", "bin/app ship status --json"],
		]);
		expect(
			ps.commands.every(
				(each) => each.opts?.cwd === "/repo" && each.opts.timeoutMs === 5000,
			),
		).toBe(true);
	});
	it("reads a deployment identity that names only its commit", async () => {
		const ps = new ScriptPs();
		ps.plan = { ...plan, identity: { kind: "commit", commit: "abc123" } };
		const client = new ShipCommandClient(ps, new NoopLogger());
		expect((await client.plan(project))?.identity).toEqual({
			kind: "commit",
			from: null,
			to: "abc123",
		});
	});
	it("passes the selected inputs to both plan and live status", async () => {
		const ps = new ScriptPs();
		const client = new ShipCommandClient(ps, new NoopLogger());
		await client.plan(project, { bump: "minor", prod: true, region: "west=2" });
		await client.status(project, { prod: true });
		expect(ps.commands.map((each) => each.argv.at(-1))).toEqual([
			"bin/app ship --input 'bump=minor' --input 'prod=true' --input 'region=west=2' plan --json",
			"bin/app ship --input 'prod=true' status --json",
		]);
	});

	it.each([
		{},
		{ ...plan, schema: 2 },
		{ ...plan, identity: { kind: "unknown", from: "x", to: "y" } },
	])("returns no plan for unsupported plans: %j", async (value) => {
		const ps = new ScriptPs();
		ps.plan = value;
		expect(
			await new ShipCommandClient(ps, new NoopLogger()).plan(project),
		).toBeNull();
	});
	it("returns no plan for non-JSON, nonzero exits and timeouts", async () => {
		const ps = new FakePs();
		const client = new ShipCommandClient(ps, new NoopLogger());
		ps.setCaptureOutput("legacy", "");
		expect(await client.plan(project)).toBeNull();
		ps.simulate(async () => 1);
		expect(await client.plan(project)).toBeNull();
		ps.simulate(async () => {
			throw new Error("timeout");
		});
		expect(await client.plan(project)).toBeNull();
	});
	it("does not execute legacy shell redirections while discovering support", async () => {
		const ps = new ScriptPs();
		expect(
			await new ShipCommandClient(ps, new NoopLogger()).plan({
				...project,
				ship: "git rev-parse HEAD > deployed",
			}),
		).toBeNull();
		expect(ps.commands).toEqual([]);
	});
	it.each([["../outside"], ["/absolute"], ["C:/outside"], ["app/**"]])(
		"refuses invalid plan source paths %j",
		async (path) => {
			const ps = new ScriptPs();
			ps.plan = { ...plan, paths: [path] };
			expect(
				await new ShipCommandClient(ps, new NoopLogger()).plan(project),
			).toBeNull();
		},
	);

	// vet-ignore simple-test-setup: this workspace and RELEASE file belong only to this graph scenario, unlike the client parsing cases
	it("takes graph identity and resuming state from the script instead of manifests and RELEASE files", async () => {
		const fs = new FakeFs();
		await fs.write(
			"/repo/package.json",
			'{"private":true,"workspaces":["packages/*"]}',
		);
		await fs.mkdir("/repo/packages/app", { recursive: true });
		await fs.write(
			"/repo/packages/app/package.json",
			'{"name":"app","version":"0.0.1"}',
		);
		await fs.write("/repo/RELEASE.app", '{"version":"0.0.2"}');
		const ps = new ScriptPs();
		const ctx = {
			fs,
			ps,
			log: new NoopLogger(),
			projects: {
				list: async () => [{ slug: "repo", root: "/repo", gone: false }],
			} as never,
			configs: {
				read: async () => ({
					legacyShips: {
						app: { ship: project.ship },
					},
				}),
			},
		};
		const graph = await registeredGraph(ctx);
		expect(graph.projects[0]).toMatchObject({
			version: "2.0.0",
			resuming: "2.3.0",
			commandPlan: plan,
			commandStatus: status,
		});
		ps.plan = {};
		expect(registeredGraph(ctx)).rejects.toThrow(
			"core/legacy-ship ShipCommand wrapper",
		);
		const commitIdentity = {
			kind: "commit",
			commit: "abcdef1234567890",
		};
		ps.plan = {
			...plan,
			identity: commitIdentity,
			resuming: false,
			paths: ["packages/app"],
		};
		ps.status = {
			identity: commitIdentity,
			artifacts: [{ name: "web", deployed: "1234567890abcdef" }],
		};
		const deploy = await registeredGraph(ctx);
		expect(deploy.projects[0]).toMatchObject({
			version: null,
			deploy: true,
			changes: { commits: 4 },
		});
		expect(
			ps.commands.some((each) =>
				each.argv.includes("1234567890abcdef^{commit}"),
			),
		).toBe(true);
	});
	it("never queries npm when a planned private target's status is unavailable or has changed identity", async () => {
		const ps = new ScriptPs();
		const live = new ShipLive(ps);
		const target = {
			...project,
			version: "0.0.1",
			packages: ["@mono/net"],
			commandPlan: plan,
		};
		ps.status = {};
		expect(live.check(target, plan.identity.to)).rejects.toThrow(
			"status --json unavailable",
		);
		ps.status = { ...status, identity: { ...identity, to: "another-release" } };
		expect(live.check(target, plan.identity.to)).rejects.toThrow(
			"status identity differs",
		);
		expect(
			ps.commands.every((each) =>
				each.argv.join(" ").endsWith("status --json"),
			),
		).toBe(true);
	});

	it("reads script artifacts for live checks without querying npm or legacy status", async () => {
		const ps = new ScriptPs();
		const live = new ShipLive(ps);
		expect(
			await live.check(
				{
					...project,
					version: "0.0.1",
					packages: [],
					commandPlan: plan,
				},
				"2.0.0",
			),
		).toMatchObject({ live: true, artifacts: status.artifacts });
		expect(ps.commands).toHaveLength(1);
	});
});

const identity = { kind: "version" as const, from: "2.0.0", to: "2.3.0" };
const plan: CommandPlan = {
	schema: 1,
	identity,
	resuming: true,
	inputs: [],
	steps: [],
};
const status: CommandStatus = {
	identity,
	artifacts: [{ name: "cdn", deployed: "2.0.0" }],
};
class ScriptPs extends FakePs {
	commands: { argv: string[]; opts?: SpawnOptions }[] = [];
	plan: unknown = plan;
	status: unknown = status;
	override async spawnCapture(
		argv: string[],
		opts?: SpawnOptions,
	): Promise<SpawnCaptureResult> {
		this.commands.push({ argv, opts });
		const command = argv.at(-1) ?? "";
		if (command.endsWith("plan --json")) {
			return { exitCode: 0, stdout: JSON.stringify(this.plan), stderr: "" };
		}
		if (command.endsWith("status --json")) {
			return { exitCode: 0, stdout: JSON.stringify(this.status), stderr: "" };
		}
		if (argv[0] === "git") {
			const stdout =
				argv[1] === "symbolic-ref"
					? "origin/main"
					: argv[1] === "rev-list"
						? "4"
						: "1234567890abcdef";
			return { exitCode: 0, stdout, stderr: "" };
		}
		return super.spawnCapture(argv, opts);
	}
}
const project = { slug: "app", root: "/repo", ship: "bin/app ship" };
