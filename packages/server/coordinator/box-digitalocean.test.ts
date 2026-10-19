import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { ChosenCloud, DIGITALOCEAN_TOKEN } from "../cloud";
import { FakeDigitalOcean } from "../cloud/testing";
import { CoordinatorBox } from "./index";
import { KeygenPs } from "./testing";

const HOME = "/home/.splates";
const KEY = `${HOME}/coordinator/id_ed25519`;

describe("CoordinatorBox in DigitalOcean", () => {
	let fs: FakeFs;
	let digitalocean: FakeDigitalOcean;
	let box: CoordinatorBox;

	beforeEach(async () => {
		fs = new FakeFs();
		digitalocean = new FakeDigitalOcean();
		digitalocean.actionsRun = true;
		const store = new FakeSecretStore();
		await store.set(DIGITALOCEAN_TOKEN, "token");
		await new ChosenCloud(HOME, fs).choose("digitalocean");
		box = new CoordinatorBox({
			version: "1.2.3",
			ps: new KeygenPs(fs),
			fs,
			home: HOME,
			store,
			fetch: digitalocean.fetch,
			wait: async () => {},
		});
	});

	function droplet() {
		const [only, ...more] = digitalocean.tagged("splates-coordinator");
		expect(more).toEqual([]);
		return only;
	}

	it("makes one backed-up box in New York, the cloud chosen in setup, reached by its own key", async () => {
		const standing = await box.up();

		const made = droplet();
		expect(standing).toEqual({
			ipv4: `203.0.113.${made?.id}`,
			serverId: String(made?.id),
			serverType: "s-2vcpu-4gb",
			location: "nyc3",
			key: KEY,
		});
		expect(made?.tags).toEqual([
			"splates-coordinator",
			"splates-coordinator:coordinator",
		]);
		expect(made?.features).toContain("backups");
		expect(made?.backup_policy).toEqual({ plan: "daily", hour: 4 });
		expect(made?.user_data).toContain("@stringsync/splates@1.2.3");
		const [key] = digitalocean.sshKeys.values();
		expect(key?.public_key).toBe("ssh-ed25519 AAAA splates-coordinator");
		expect(made?.ssh_keys).toEqual([key?.id ?? 0]);
	});

	it("lets SSH alone in, and everything out", async () => {
		await box.up();

		const [firewall] = digitalocean.firewalls.values();
		expect(firewall?.droplet_ids).toEqual([droplet()?.id ?? 0]);
		expect(firewall?.inbound_rules).toEqual([
			{
				protocol: "tcp",
				ports: "22",
				sources: { addresses: ["0.0.0.0/0", "::/0"] },
			},
		]);
		expect(firewall?.outbound_rules).toHaveLength(3);
	});

	it("makes one box and one key across ups, keeping it behind its firewall", async () => {
		await box.up();
		await box.up();

		expect(digitalocean.tagged("splates-coordinator")).toHaveLength(1);
		expect(digitalocean.sshKeys.size).toBe(1);
		const [firewall] = digitalocean.firewalls.values();
		expect(firewall?.droplet_ids).toEqual([droplet()?.id ?? 0]);
	});

	it("destroys the box, then its firewall and key", async () => {
		await box.up();

		await box.remove();

		expect(digitalocean.droplets.size).toBe(0);
		expect(digitalocean.firewalls.size).toBe(0);
		expect(digitalocean.sshKeys.size).toBe(0);
		expect(await box.status()).toBeNull();
	});
});
