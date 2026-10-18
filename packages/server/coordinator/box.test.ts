import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { HCLOUD_TOKEN, PULUMI_PASSPHRASE, pulumiPaths } from "../workers";
import { CoordinatorBox, installScript } from "./index";

const HOME = "/home/.splates";
const PATHS = pulumiPaths(HOME);
const KEY = `${HOME}/coordinator/id_ed25519`;

describe("CoordinatorBox", () => {
	let fs: FakeFs;
	let ps: BoxPs;
	let store: FakeSecretStore;
	let box: CoordinatorBox;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new BoxPs(fs);
		store = new FakeSecretStore();
		await store.set(PULUMI_PASSPHRASE, "pass");
		await store.set(HCLOUD_TOKEN, "token");
		box = new CoordinatorBox({ version: "1.2.3", ps, fs, home: HOME, store });
	});

	it("makes one protected, backed-up box in Ashburn reached by its own key", async () => {
		const standing = await box.up();

		expect(standing).toEqual({
			ipv4: "203.0.113.7",
			serverId: "42",
			serverType: "cpx21",
			location: "ash",
			key: KEY,
		});
		const server = (await ps.program()).resources.server.properties;
		expect(server.backups).toBe(true);
		expect(server.deleteProtection).toContain("protect");
		expect(server.rebuildProtection).toContain("protect");
		expect(ps.config).toMatchObject({
			serverType: "cpx21",
			location: "ash",
			publicKey: "ssh-ed25519 AAAA splates-coordinator",
			protect: "true",
		});
		expect(ps.config.userData).toContain("@stringsync/splates@1.2.3");
		const up = ps.runs.find((run) => run.args[0] === "up");
		expect(up?.env[HCLOUD_TOKEN]).toBe("token");
	});

	it("opens SSH alone", async () => {
		await box.up();

		const rules = (await ps.program()).resources.firewall.properties.rules;
		expect(rules).toEqual([
			{
				direction: "in",
				protocol: "tcp",
				port: "22",
				sourceIps: ["0.0.0.0/0", "::/0"],
			},
		]);
	});

	it("keeps its key across ups", async () => {
		await box.up();
		await box.up();

		expect(ps.keygens).toBe(1);
	});

	it("never replaces the box for a newer install script", async () => {
		await box.up();

		expect((await ps.program()).resources.server.options.ignoreChanges).toEqual(
			["userData"],
		);
	});

	it("says there is no box before one is made", async () => {
		expect(await box.status()).toBeNull();
	});

	it("lifts its protection before destroying it, then forgets its stack", async () => {
		await box.up();
		ps.runs.length = 0;

		await box.remove();

		expect(ps.commands()).toEqual([
			"stack ls --json",
			"config set protect false --stack coordinator",
			"up --yes --skip-preview --stack coordinator",
			"destroy --yes --skip-preview --stack coordinator",
			"stack rm --yes coordinator",
		]);
		expect(await box.status()).toBeNull();
	});

	it("does nothing to remove when there is no box", async () => {
		await box.remove();

		expect(ps.commands()).toEqual(["stack ls --json"]);
	});

	it("installs splates on the box for its own user, and cloudflared, with no credentials", () => {
		const script = installScript("1.2.3");

		expect(script).toContain("useradd --create-home --shell /bin/bash splates");
		expect(script).toContain(
			"su - splates -c '/home/splates/.bun/bin/bun add -g @stringsync/splates@1.2.3'",
		);
		expect(script).toContain("dpkg -i /tmp/cloudflared.deb");
		expect(script).toContain("gnome-keyring");
		expect(script).toContain(
			"test -s /root/splates-keyring || (umask 077 && head -c 32 /dev/urandom | base64 > /root/splates-keyring)",
		);
	});
	it("asks for the Hetzner token's setup step without one", async () => {
		await store.delete(HCLOUD_TOKEN);

		await expect(box.up()).rejects.toThrow("hetzner-token");
	});
});

interface Run {
	args: string[];
	env: Record<string, string>;
}

/** A Pulumi CLI and ssh-keygen that remember what they were asked, against a `FakeFs`. */
class BoxPs extends FakePs {
	readonly runs: Run[] = [];
	readonly stacks = new Set<string>();
	readonly config: Record<string, string> = {};
	keygens = 0;
	private dir = "";

	constructor(private readonly fs: FakeFs) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
		const [bin, ...args] = argv;
		if (bin === "ssh-keygen") {
			this.keygens++;
			const at = args.indexOf("-f");
			await this.fs.write(
				`${args[at + 1]}.pub`,
				"ssh-ed25519 AAAA splates-coordinator\n",
			);
			return ok();
		}
		expect(bin).toBe(PATHS.bin);
		this.dir = opts?.cwd ?? "";
		this.runs.push({ args, env: opts?.env ?? {} });
		const stack = args.at(-1) ?? "";
		if (args[0] === "stack" && args[1] === "select") {
			this.stacks.add(stack);
		} else if (args[0] === "stack" && args[1] === "rm") {
			this.stacks.delete(stack);
		} else if (args[0] === "stack" && args[1] === "ls") {
			return ok(JSON.stringify([...this.stacks].map((name) => ({ name }))));
		} else if (args[0] === "stack" && args[1] === "output") {
			return ok(
				JSON.stringify({
					ipv4: "203.0.113.7",
					serverId: "42",
					serverType: this.config.serverType,
					location: this.config.location,
				}),
			);
		} else if (args[0] === "config" && args[1] === "set") {
			const key = args[2] ?? "";
			this.config[key] = args[3] ?? "";
		}
		return ok();
	}

	/** The program Pulumi was last run against. */
	async program(): Promise<BoxProgram> {
		return JSON.parse(await this.fs.read(`${this.dir}/Pulumi.yaml`));
	}

	/** The commands run, each as its words. */
	commands(): string[] {
		return this.runs.map((run) => run.args.join(" "));
	}
}

interface BoxProgram {
	resources: {
		server: {
			properties: Record<string, unknown>;
			options: { ignoreChanges?: string[] };
		};
		firewall: { properties: { rules: unknown[] } };
	};
}
