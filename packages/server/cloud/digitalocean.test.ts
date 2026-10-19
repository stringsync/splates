import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { DIGITALOCEAN_TOKEN, DigitalOceanCloud } from "./index";
import { FakeDigitalOcean } from "./testing";
import { CloudWorkers } from "./workers";

describe("CloudWorkers in DigitalOcean", () => {
	let digitalocean: FakeDigitalOcean;
	let store: FakeSecretStore;
	let stuck: boolean;
	let provider: CloudWorkers;

	beforeEach(async () => {
		digitalocean = new FakeDigitalOcean();
		digitalocean.actionsRun = true;
		digitalocean.stock = {
			nyc3: ["s-8vcpu-16gb", "s-1vcpu-2gb"],
			sfo3: ["s-8vcpu-16gb"],
		};
		store = new FakeSecretStore();
		await store.set(DIGITALOCEAN_TOKEN, "token");
		stuck = false;
		const wait = async () => {
			if (!stuck) {
				for (const builder of digitalocean.tagged("splates-snapshot-builder")) {
					builder.status = "off";
				}
			}
		};
		provider = new CloudWorkers(
			new DigitalOceanCloud({ store, fetch: digitalocean.fetch, wait }),
			{ wall: { now: () => 1000 }, wait },
		);
	});

	it("offers its size, billed by the second, while a region can make it", async () => {
		expect(await provider.types()).toEqual([
			{
				name: "s-8vcpu-16gb",
				platform: "linux",
				slots: 4,
				dollarsPerHour: 0.14286,
				billing: "second",
			},
		]);

		digitalocean.stock = { ams3: ["s-8vcpu-16gb"] };
		expect(await provider.types()).toEqual([]);
	});

	it("makes a worker tagged with its id, in the first region with stock, from the snapshot, its boot in its user data", async () => {
		digitalocean.stock = { nyc1: ["s-8vcpu-16gb"] };

		await provider.create({
			id: "s-8vcpu-16gb-abc123",
			type: "s-8vcpu-16gb",
			snapshot: "77",
			boot: ["splates", "worker", "run", "--join", "secret-token"],
		});

		const [droplet] = digitalocean.tagged("splates-worker:s-8vcpu-16gb-abc123");
		expect(droplet).toMatchObject({
			name: "s-8vcpu-16gb-abc123",
			size_slug: "s-8vcpu-16gb",
			image: 77,
			region: { slug: "nyc1" },
		});
		expect(droplet?.user_data).toContain(
			'ExecStart="splates" "worker" "run" "--join" "secret-token"',
		);
		expect(await provider.list()).toEqual([
			{ id: "s-8vcpu-16gb-abc123", type: "s-8vcpu-16gb" },
		]);
	});

	it("destroys a worker's droplet alone, and says why DigitalOcean refused one", async () => {
		const spec = { type: "s-8vcpu-16gb", snapshot: "1", boot: [] };
		await provider.create({ id: "w", ...spec });
		await provider.create({ id: "v", ...spec });

		await provider.destroy("w");
		await provider.destroy("gone");

		expect(await provider.list()).toEqual([{ id: "v", type: "s-8vcpu-16gb" }]);

		digitalocean.refuseCreate = "droplet limit reached";
		await expect(provider.create({ id: "u", ...spec })).rejects.toThrow(
			"droplet limit reached",
		);
		expect(digitalocean.droplets.size).toBe(1);
	});

	it("builds a snapshot on a small builder, tags it with its platform, then lets the builder and the last snapshot go", async () => {
		digitalocean.images.set(7, {
			id: 7,
			tags: ["splates-snapshot", "splates-snapshot:linux"],
		});

		const snapshot = await provider.snapshot({
			platform: "linux",
			version: "1.2.3",
			script: "#!/bin/sh\necho recipe\n",
		});

		const builder = digitalocean.requests.find(
			(each) => each.method === "POST" && each.path === "/droplets",
		);
		expect(builder?.body).toMatchObject({
			size: "s-1vcpu-2gb",
			image: "ubuntu-24-04-x64",
			region: "nyc3",
		});
		expect(String(builder?.body?.user_data)).toContain("echo recipe");
		expect(digitalocean.droplets.size).toBe(0);
		expect([...digitalocean.images.keys()].map(String)).toEqual([snapshot.id]);
		expect(digitalocean.images.get(Number(snapshot.id))?.tags).toEqual([
			"splates-snapshot",
			"splates-snapshot:linux",
		]);
	});

	it("lets the builder go, keeping the last snapshot, when the recipe never finishes", async () => {
		stuck = true;
		digitalocean.images.set(7, {
			id: 7,
			tags: ["splates-snapshot", "splates-snapshot:linux"],
		});

		await expect(
			provider.snapshot({ platform: "linux", version: "1.2.3", script: "" }),
		).rejects.toThrow("did not finish within 40 minutes");

		expect(digitalocean.droplets.size).toBe(0);
		expect([...digitalocean.images.keys()]).toEqual([7]);
	});

	it("takes a token only once DigitalOcean does", async () => {
		const cloud = new DigitalOceanCloud({ store, fetch: digitalocean.fetch });
		expect(await cloud.accepted()).toBe(true);

		await store.set(DIGITALOCEAN_TOKEN, "wrong");
		expect(await cloud.accepted()).toBe(false);

		await store.delete(DIGITALOCEAN_TOKEN);
		expect(await cloud.accepted()).toBe(false);
	});

	it("names the setup step when it has no token", async () => {
		await store.delete(DIGITALOCEAN_TOKEN);

		await expect(provider.types()).rejects.toThrow(
			"do the setup step `cloud-token`",
		);
	});
});
