import { beforeEach, describe, expect, it } from "bun:test";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { CoordinatorBox, hostKeys } from "./box";
import { infraConfigPath, writeInfraConfig } from "./infra";
import { FakeBoxCloud } from "./testing";

const HOME = "/Users/me/.splates";
const OUTPUTS = {
	instanceId: "i-0abc",
	ipv4: "203.0.113.7",
	roleName: "splates-role",
	tunnelHost: "splates.example.com",
};
const CONSOLE = [
	"Cloud-init v. 24.1 finished",
	"-----BEGIN SSH HOST KEY FINGERPRINTS-----",
	"256 SHA256:abc root@ip (ED25519)",
	"-----END SSH HOST KEY FINGERPRINTS-----",
	"-----BEGIN SSH HOST KEY KEYS-----",
	"ecdsa-sha2-nistp256 AAAAecdsa root@ip",
	"ssh-ed25519 AAAAed root@ip",
	"-----END SSH HOST KEY KEYS-----",
	"",
].join("\n");

describe("CoordinatorBox", () => {
	let fs: FakeFs;
	let ps: PulumiPs;
	let cloud: FakeBoxCloud;
	let box: CoordinatorBox;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new PulumiPs();
		cloud = new FakeBoxCloud();
		cloud.consoles = [CONSOLE];
		box = new CoordinatorBox({
			fs,
			ps,
			home: HOME,
			cloud,
			within: Duration.ms(20),
			wait: async () => {},
		});
		await writeInfraConfig(fs, HOME, { dir: "/code/infra", stack: "prod" });
	});

	it("has no box before an infra project is recorded", async () => {
		const bare = new CoordinatorBox({ fs: new FakeFs(), ps, home: HOME });

		expect(await bare.status()).toBeNull();
		expect(ps.asked).toEqual([]);
	});

	it("reads where the box is from the stack's outputs, run in the project", async () => {
		expect(await box.status()).toEqual({
			ipv4: "203.0.113.7",
			instanceId: "i-0abc",
			roleName: "splates-role",
			host: "splates.example.com",
			key: `${HOME}/coordinator/id_ed25519`,
		});
		expect(ps.asked[0]).toEqual({
			argv: ["pulumi", "stack", "output", "--json", "--stack", "prod"],
			cwd: "/code/infra",
		});
	});

	it("carries the tunnel record the stack exports", async () => {
		ps.outputs = {
			...OUTPUTS,
			tunnelRecord: { team: "acme", aud: "aud1", id: "tun1" },
		};

		expect((await box.status())?.tunnel).toEqual({
			host: "splates.example.com",
			team: "acme",
			aud: "aud1",
			tunnel: "tun1",
		});
	});

	it("has no box while the stack has not exported one", async () => {
		ps.outputs = {};

		expect(await box.status()).toBeNull();
		await expect(box.ready()).rejects.toThrow("pulumi up");
	});

	it("keeps the stack's login key once, and holds the box to the host key its console printed", async () => {
		await box.ready();
		await box.ready();

		expect(await fs.read(`${HOME}/coordinator/id_ed25519`)).toBe(
			"PRIVATE KEY\n",
		);
		expect(
			ps.asked.filter(({ argv }) => argv.includes("--show-secrets")),
		).toHaveLength(1);
		expect(await fs.read(`${HOME}/coordinator/known_hosts`)).toBe(
			"203.0.113.7 ecdsa-sha2-nistp256 AAAAecdsa\n203.0.113.7 ssh-ed25519 AAAAed\n",
		);
	});

	it("waits for the console to print the keys, and says so when it never does", async () => {
		cloud.consoles = ["", "", CONSOLE];
		await box.ready();
		expect(await fs.exists(`${HOME}/coordinator/known_hosts`)).toBe(true);

		await fs.rm(`${HOME}/coordinator/known_hosts`);
		cloud.consoles = [];
		await expect(box.ready()).rejects.toThrow("has not printed its host keys");
	});

	it("uses the user's own key when the project names one", async () => {
		await writeInfraConfig(fs, HOME, { dir: "/code/infra", key: "/me/key" });

		expect((await box.ready()).key).toBe("/me/key");
		expect(await fs.exists(`${HOME}/coordinator/id_ed25519`)).toBe(false);
	});

	it("refreshes the state before `pulumi up`, so a run after a failed one carries on from what is there", async () => {
		await box.up();

		expect(ps.commands).toEqual(["stack", "refresh", "up"]);
		expect(ps.asked[0]?.argv).toEqual([
			"pulumi",
			"stack",
			"select",
			"--create",
			"prod",
			"--non-interactive",
		]);
		expect(ps.asked[1]?.argv).toEqual([
			"pulumi",
			"refresh",
			"--yes",
			"--non-interactive",
			"--stack",
			"prod",
		]);
	});

	it("cancels the lock a killed run left on the stack, and runs once more", async () => {
		ps.failures = [
			{
				command: "up",
				output:
					"error: [409] Conflict: Another update is currently in progress.\n",
			},
		];

		await box.up();

		expect(ps.commands).toEqual(["stack", "refresh", "up", "cancel", "up"]);
		expect(ps.asked[3]?.argv).toEqual([
			"pulumi",
			"cancel",
			"--yes",
			"--stack",
			"prod",
		]);
	});

	it("gives up on a stack still locked after cancelling, with pulumi's line", async () => {
		const locked =
			"error: [409] Conflict: Another update is currently in progress.\n";
		ps.failures = [
			{ command: "up", output: locked },
			{ command: "up", output: locked },
		];

		await expect(box.up()).rejects.toThrow("Another update is currently");
		expect(ps.commands).toEqual(["stack", "refresh", "up", "cancel", "up"]);
	});

	it("destroys the stack after lifting the box's protection, and forgets its keys", async () => {
		await box.ready();

		await box.destroy();

		expect(cloud.protections).toEqual([["i-0abc", false]]);
		expect(ps.commands.slice(-2)).toEqual(["refresh", "destroy"]);
		expect(ps.asked.at(-1)?.argv).toEqual([
			"pulumi",
			"destroy",
			"--yes",
			"--non-interactive",
			"--stack",
			"prod",
		]);
		expect(await fs.exists(`${HOME}/coordinator/id_ed25519`)).toBe(false);
		expect(await fs.read(`${HOME}/coordinator/known_hosts`)).toBe("");
	});

	it("destroys a stack whose box is already gone without touching its protection", async () => {
		cloud.there = false;

		await box.destroy();

		expect(cloud.protections).toEqual([]);
		expect(ps.commands.slice(-2)).toEqual(["refresh", "destroy"]);
	});

	it("leaves the user's own key when destroying", async () => {
		await writeInfraConfig(fs, HOME, {
			dir: "/code/infra",
			stack: "prod",
			key: "/me/key",
		});
		await fs.write("/me/key", "MINE\n");

		await box.destroy();

		expect(await fs.read("/me/key")).toBe("MINE\n");
	});

	it("removes the stack and forgets the project", async () => {
		await box.remove();

		expect(ps.asked.at(-1)?.argv).toEqual([
			"pulumi",
			"stack",
			"rm",
			"--yes",
			"--stack",
			"prod",
		]);
		expect(await fs.exists(infraConfigPath(HOME))).toBe(false);
		expect(await box.status()).toBeNull();
	});

	it("forgets a project whose stack was never made", async () => {
		ps.failures = [
			{ command: "stack", output: "error: no stack named 'prod' found\n" },
		];

		await box.remove();

		expect(await fs.exists(infraConfigPath(HOME))).toBe(false);
	});

	it("reads only host keys from a console's key block", () => {
		expect(hostKeys(CONSOLE)).toEqual([
			"ecdsa-sha2-nistp256 AAAAecdsa",
			"ssh-ed25519 AAAAed",
		]);
		expect(hostKeys("no keys yet")).toEqual([]);
	});
});

/**
 * `pulumi`, remembering where it ran and what it was asked, and failing each
 * command `failures` names next, in order, with its output.
 */
class PulumiPs extends FakePs {
	readonly asked: { argv: string[]; cwd: string | undefined }[] = [];
	outputs: unknown = OUTPUTS;
	failures: { command: string; output: string }[] = [];

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		this.asked.push({ argv, cwd: opts?.cwd });
		const failure = this.failures[0];
		if (failure !== undefined && argv[1] === failure.command) {
			this.failures.shift();
			return { exitCode: 1, stdout: "", stderr: failure.output };
		}
		const stdout = argv.includes("sshKey")
			? "PRIVATE KEY\n"
			: JSON.stringify(this.outputs);
		return { exitCode: 0, stdout, stderr: "" };
	}

	/** Each `pulumi` command run, as "refresh", "up". */
	get commands(): string[] {
		return this.asked.map(({ argv }) => argv[1] as string);
	}
}
