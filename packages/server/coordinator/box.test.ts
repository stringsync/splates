import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { HCLOUD_TOKEN } from "../workers";
import { FakeHetzner } from "../workers/testing";
import { CoordinatorBox, installScript } from "./index";

const HOME = "/home/.splates";
const KEY = `${HOME}/coordinator/id_ed25519`;

describe("CoordinatorBox", () => {
	let fs: FakeFs;
	let ps: KeygenPs;
	let hetzner: FakeHetzner;
	let store: FakeSecretStore;
	let box: CoordinatorBox;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new KeygenPs(fs);
		hetzner = new FakeHetzner();
		store = new FakeSecretStore();
		await store.set(HCLOUD_TOKEN, "token");
		box = new CoordinatorBox({
			version: "1.2.3",
			ps,
			fs,
			home: HOME,
			store,
			fetch: hetzner.fetch,
			wait: async () => {},
		});
	});

	function server() {
		const [only, ...more] = hetzner.labelled("splates-coordinator");
		expect(more).toEqual([]);
		return only;
	}

	it("makes one protected, backed-up box in Ashburn reached by its own key", async () => {
		const standing = await box.up();

		const made = server();
		expect(standing).toEqual({
			ipv4: made?.public_net.ipv4?.ip ?? "",
			serverId: String(made?.id),
			serverType: "cpx21",
			location: "ash",
			key: KEY,
		});
		expect(made?.backup_window).not.toBeNull();
		expect(made?.protection).toEqual({ delete: true, rebuild: true });
		expect(made?.user_data).toContain("@stringsync/splates@1.2.3");
		const [key] = hetzner.sshKeys.values();
		expect(key?.public_key).toBe("ssh-ed25519 AAAA splates-coordinator");
		expect(made?.ssh_keys).toEqual([key?.id ?? 0]);
	});

	it("opens SSH alone", async () => {
		await box.up();

		const [firewall] = hetzner.firewalls.values();
		expect(server()?.firewalls).toEqual([{ firewall: firewall?.id ?? 0 }]);
		expect(firewall?.rules).toEqual([
			{
				direction: "in",
				protocol: "tcp",
				port: "22",
				source_ips: ["0.0.0.0/0", "::/0"],
			},
		]);
	});

	it("makes one box and one key across ups, putting its firewall's rules back", async () => {
		await box.up();
		const [firewall] = hetzner.firewalls.values();
		await hetzner.fetch(
			`https://api.hetzner.cloud/v1/firewalls/${firewall?.id}/actions/set_rules`,
			{
				method: "POST",
				headers: { Authorization: "Bearer token" },
				body: JSON.stringify({ rules: [] }),
			},
		);

		await box.up();

		expect(ps.keygens).toBe(1);
		expect(hetzner.sshKeys.size).toBe(1);
		expect(server()).toBeDefined();
		expect(firewall?.rules).toHaveLength(1);
	});

	it("says there is no box before one is made", async () => {
		expect(await box.status()).toBeNull();
	});

	it("lifts its protection before destroying it, then its firewall and key", async () => {
		await box.up();

		await box.remove();

		expect(hetzner.servers.size).toBe(0);
		expect(hetzner.firewalls.size).toBe(0);
		expect(hetzner.sshKeys.size).toBe(0);
		expect(await box.status()).toBeNull();
	});

	it("does nothing to remove when there is no box", async () => {
		await box.remove();

		expect(hetzner.calls().filter((call) => !call.startsWith("GET"))).toEqual(
			[],
		);
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

/** An ssh-keygen that writes its public key into a `FakeFs`, counting its runs. */
class KeygenPs extends FakePs {
	keygens = 0;

	constructor(private readonly fs: FakeFs) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		expect(argv[0]).toBe("ssh-keygen");
		this.keygens++;
		const at = argv.indexOf("-f");
		await this.fs.write(
			`${argv[at + 1]}.pub`,
			"ssh-ed25519 AAAA splates-coordinator\n",
		);
		return { exitCode: 0, stdout: "", stderr: "" };
	}
}
