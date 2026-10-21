import { beforeEach, describe, expect, it } from "bun:test";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { CoordinatorBox, hostKeys } from "./box";
import { writeInfraConfig } from "./infra";

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

/** `pulumi`, remembering where it ran and what it was asked. */
class PulumiPs extends FakePs {
	readonly asked: { argv: string[]; cwd: string | undefined }[] = [];
	outputs: unknown = OUTPUTS;

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		this.asked.push({ argv, cwd: opts?.cwd });
		const stdout = argv.includes("sshKey")
			? "PRIVATE KEY\n"
			: JSON.stringify(this.outputs);
		return { exitCode: 0, stdout, stderr: "" };
	}
}

describe("CoordinatorBox", () => {
	let fs: FakeFs;
	let ps: PulumiPs;
	let consoles: string[];
	let box: CoordinatorBox;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new PulumiPs();
		consoles = [CONSOLE];
		box = new CoordinatorBox({
			fs,
			ps,
			home: HOME,
			cloud: { consoleOutput: async () => consoles.shift() ?? "" },
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
		consoles = ["", "", CONSOLE];
		await box.ready();
		expect(await fs.exists(`${HOME}/coordinator/known_hosts`)).toBe(true);

		await fs.rm(`${HOME}/coordinator/known_hosts`);
		consoles = [];
		await expect(box.ready()).rejects.toThrow("has not printed its host keys");
	});

	it("uses the user's own key when the project names one", async () => {
		await writeInfraConfig(fs, HOME, { dir: "/code/infra", key: "/me/key" });

		expect((await box.ready()).key).toBe("/me/key");
		expect(await fs.exists(`${HOME}/coordinator/id_ed25519`)).toBe(false);
	});

	it("reads only host keys from a console's key block", () => {
		expect(hostKeys(CONSOLE)).toEqual([
			"ecdsa-sha2-nistp256 AAAAecdsa",
			"ssh-ed25519 AAAAed",
		]);
		expect(hostKeys("no keys yet")).toEqual([]);
	});
});
