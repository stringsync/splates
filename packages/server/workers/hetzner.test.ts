import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { HetznerWorkerProvider } from "./hetzner";
import { HCLOUD_TOKEN } from "./hetzner-api";
import { PULUMI_PASSPHRASE, pulumiPaths } from "./pulumi";

const HOME = "/home/.splates";
const PATHS = pulumiPaths(HOME);

describe("HetznerWorkerProvider", () => {
	let ps: PulumiPs;
	let fs: FakeFs;
	let store: FakeSecretStore;
	/** Type names orderable, by location. */
	let stock: Record<string, string[]>;
	let status: string;
	let stuck: boolean;
	let provider: HetznerWorkerProvider;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new PulumiPs(fs);
		store = new FakeSecretStore();
		await store.set(PULUMI_PASSPHRASE, "pass");
		await store.set(HCLOUD_TOKEN, "token");
		stock = { nbg1: ["cpx62", "cpx22"], fsn1: ["cpx62", "cx53", "cpx22"] };
		status = "running";
		stuck = false;
		const ids = ["cx53", "cpx62", "cx23", "cpx22"];
		const fetch = (async (url: string, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("Authorization")).toBe(
				"Bearer token",
			);
			const { pathname } = new URL(url);
			if (pathname === "/v1/server_types") {
				return Response.json({
					server_types: ids.map((name, id) => ({ id, name })),
				});
			}
			if (pathname === "/v1/datacenters") {
				return Response.json({
					datacenters: Object.entries(stock).map(([name, types]) => ({
						location: { name },
						server_types: { available: types.map((type) => ids.indexOf(type)) },
					})),
				});
			}
			if (pathname === "/v1/servers/42") {
				return Response.json({ server: { status } });
			}
			return Response.json({
				servers: [
					{
						name: "cpx62-aaaaaa",
						server_type: { name: "cpx62" },
						labels: { "splates-worker": "cpx62-aaaaaa" },
					},
				],
			});
		}) as unknown as typeof globalThis.fetch;
		provider = new HetznerWorkerProvider({
			ps,
			fs,
			home: HOME,
			store,
			fetch,
			wall: { now: () => 1000 },
			wait: async () => {
				status = stuck ? status : "off";
			},
		});
	});

	it("offers the CX53 only while one of its locations can make it", async () => {
		expect((await provider.types()).map((type) => type.name)).toEqual([
			"cx53",
			"cpx62",
		]);

		stock.fsn1 = ["cpx62"];
		expect((await provider.types()).map((type) => type.name)).toEqual([
			"cpx62",
		]);
	});

	it("makes a worker in its own stack, in the first location with stock, its boot passed as a secret on stdin", async () => {
		const made = await provider.create({
			id: "cx53-abc123",
			type: "cx53",
			snapshot: "77",
			boot: ["splates", "worker", "run", "--join", "secret-token"],
		});

		expect(made).toEqual({ id: "cx53-abc123", type: "cx53" });
		expect(ps.commands()).toEqual([
			"stack select --create --secrets-provider passphrase cx53-abc123",
			"config set serverType cx53 --stack cx53-abc123",
			"config set image 77 --stack cx53-abc123",
			"config set location fsn1 --stack cx53-abc123",
			"config set --secret userData --stack cx53-abc123",
			"up --yes --skip-preview --stack cx53-abc123",
		]);
		const secret = ps.runs[4] as Run;
		expect(secret.stdin).toContain(
			'ExecStart="splates" "worker" "run" "--join" "secret-token"',
		);
		expect(ps.commands().join("\n")).not.toContain("secret-token");
		expect(ps.runs[5]?.env).toMatchObject({
			HCLOUD_TOKEN: "token",
			PULUMI_CONFIG_PASSPHRASE: "pass",
			PULUMI_BACKEND_URL: `file://${PATHS.state}`,
		});
		expect(
			await fs.read(`${PATHS.root}/projects/splates-worker/Pulumi.yaml`),
		).toContain('"hcloud:Server"');
	});

	it("refuses a type no location can make, and destroys what a failed up left", async () => {
		stock = { nbg1: ["cpx62"] };
		await expect(
			provider.create({ id: "w", type: "cx53", snapshot: "1", boot: [] }),
		).rejects.toThrow("Hetzner cannot make a cx53 in nbg1, fsn1, hel1");

		ps.failUp = true;
		await expect(
			provider.create({ id: "w", type: "cpx62", snapshot: "1", boot: [] }),
		).rejects.toThrow("pulumi up failed: error: server limit");
		expect(ps.commands().slice(-3)).toEqual([
			"stack ls --json",
			"destroy --yes --skip-preview --stack w",
			"stack rm --yes w",
		]);
		expect(ps.stacks.has("w")).toBe(false);
	});

	it("destroys nothing for a worker it has no stack of", async () => {
		await provider.destroy("gone");

		expect(ps.commands()).toEqual(["stack ls --json"]);
	});

	it("lists the servers labelled as its workers", async () => {
		expect(await provider.list()).toEqual([
			{ id: "cpx62-aaaaaa", type: "cpx62" },
		]);
	});

	it("builds a snapshot on a small builder, makes it once the recipe powers it off, then lets the builder and the last snapshot go", async () => {
		ps.outputs = {
			builderId: "42",
			snapshotId: "77",
			kept: { name: "snapshot_1", serverId: 7, version: "1.0.0" },
		};

		const snapshot = await provider.snapshot({
			platform: "linux",
			version: "1.2.3",
			script: "#!/bin/sh\necho recipe\n",
		});

		const [building, imaging, done] = ps.ups;
		expect(ps.ups).toHaveLength(3);
		expect(Object.keys(building ?? {})).toEqual(["builder", "snapshot_1"]);
		expect(Object.keys(imaging ?? {})).toEqual(["builder", "snapshot_1000"]);
		expect(Object.keys(done ?? {})).toEqual(["snapshot_1000"]);
		expect(done?.snapshot_1000).toMatchObject({
			properties: { serverId: 42 },
		});
		expect(JSON.stringify(building)).toContain("cpx22");
		expect(JSON.stringify(building)).toContain("echo recipe");
		expect(snapshot).toEqual({ id: "77", version: "1.2.3", builtAt: 1000 });
	});

	it("lets the builder go, keeping the last snapshot, when the recipe never finishes", async () => {
		stuck = true;
		ps.outputs = {
			builderId: "42",
			kept: { name: "snapshot_1", serverId: 7, version: "1.0.0" },
		};

		await expect(
			provider.snapshot({ platform: "linux", version: "1.2.3", script: "" }),
		).rejects.toThrow("did not finish within 40 minutes");

		expect(Object.keys(ps.ups.at(-1) ?? {})).toEqual(["snapshot_1"]);
	});

	it("names the setup step when it has no token", async () => {
		await store.delete(HCLOUD_TOKEN);

		await expect(provider.types()).rejects.toThrow(
			"do the setup step `hetzner-token`",
		);
	});
});

interface Run {
	args: string[];
	env: Record<string, string>;
	stdin: string;
}

/**
 * A `pulumi` that remembers its stacks, answers each stack's outputs as the
 * test sets them, and keeps the program each `up` ran.
 */
class PulumiPs extends FakePs {
	readonly runs: Run[] = [];
	/** Each `up`'s program's resources, by name. */
	readonly ups: Record<string, unknown>[] = [];
	readonly stacks = new Set<string>();
	outputs: Record<string, unknown> = {};
	failUp = false;

	constructor(private readonly fs: FakeFs) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		const [bin, ...args] = argv;
		expect(bin).toBe(PATHS.bin);
		this.runs.push({ args, env: opts?.env ?? {}, stdin: opts?.stdin ?? "" });
		const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
		const stack = args.at(-1) ?? "";
		if (args[0] === "stack" && args[1] === "select") {
			this.stacks.add(stack);
		} else if (args[0] === "stack" && args[1] === "rm") {
			this.stacks.delete(stack);
		} else if (args[0] === "stack" && args[1] === "ls") {
			return ok(JSON.stringify([...this.stacks].map((name) => ({ name }))));
		} else if (args[0] === "stack" && args[1] === "output") {
			return ok(JSON.stringify(this.outputs));
		} else if (args[0] === "up") {
			const program = await this.fs.read(`${opts?.cwd}/Pulumi.yaml`);
			this.ups.push(JSON.parse(program).resources);
			if (this.failUp) {
				return { exitCode: 255, stdout: "", stderr: "error: server limit\n" };
			}
		}
		return ok();
	}

	/** The commands run, each as its words. */
	commands(): string[] {
		return this.runs.map((run) => run.args.join(" "));
	}
}
