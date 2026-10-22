import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { Duration } from "webappwiz/time";
import { TypeRefused } from "../workers";
import { DIGITALOCEAN_TOKEN, DigitalOceanCloud } from "./index";
import { FakeDigitalOcean } from "./testing";
import { CloudWorkers } from "./workers";

describe("CloudWorkers in DigitalOcean", () => {
	let digitalocean: FakeDigitalOcean;
	let store: FakeSecretStore;
	let stuck: boolean;
	let now: number;
	let provider: CloudWorkers;

	beforeEach(async () => {
		digitalocean = new FakeDigitalOcean();
		digitalocean.actionsRun = true;
		digitalocean.stock = {
			nyc3: ["s-4vcpu-8gb", "s-1vcpu-2gb"],
			sfo3: ["s-4vcpu-8gb"],
		};
		store = new FakeSecretStore();
		await store.set(DIGITALOCEAN_TOKEN, "token");
		stuck = false;
		now = 1000;
		const wait = async () => {
			if (!stuck) {
				for (const builder of digitalocean.tagged("splates-snapshot-builder")) {
					builder.status = "off";
				}
			}
		};
		provider = new CloudWorkers(
			new DigitalOceanCloud({ store, fetch: digitalocean.fetch, wait }),
			{ wall: { now: () => now }, wait },
		);
	});

	it("offers the sizes that hold a job, the cheapest first, billed by the second at the price the API says, while any region can make them", async () => {
		digitalocean.prices = {
			"s-4vcpu-8gb": 0.0714,
			"c-4": 0.125,
			"s-8vcpu-16gb": 0.143,
		};
		digitalocean.stock = {
			nyc3: ["c-4", "s-4vcpu-8gb", "s-2vcpu-4gb", "s-1vcpu-2gb"],
			sfo3: ["s-8vcpu-16gb", "c-32"],
		};
		expect(await provider.types()).toEqual([
			{
				name: "s-4vcpu-8gb",
				platform: "linux",
				slots: 1,
				cpus: 4,
				memory: 8,
				dollarsPerHour: 0.0714,
				billing: "second",
			},
			expect.objectContaining({ name: "c-4", cpus: 4, memory: 8 }),
			expect.objectContaining({ name: "s-8vcpu-16gb", cpus: 8, memory: 16 }),
		]);
		expect(provider.billing).toBe("digitalocean");

		digitalocean.stock = { ams3: ["c-16"] };
		expect((await provider.types()).map((type) => type.name)).toEqual(["c-16"]);

		digitalocean.stock = { ams3: ["c-32", "s-2vcpu-4gb"] };
		expect(await provider.types()).toEqual([]);
	});

	it("offers only the sizes that hold the project's job", async () => {
		digitalocean.stock = { nyc3: ["s-4vcpu-8gb", "s-8vcpu-16gb", "c-16"] };
		const big = new CloudWorkers(
			new DigitalOceanCloud({ store, fetch: digitalocean.fetch }),
			{ job: { cpus: 6, memory: 12 } },
		);

		expect((await big.types()).map((type) => type.name)).toEqual([
			"s-8vcpu-16gb",
			"c-16",
		]);
	});

	it("leaves out a size DigitalOcean refuses the account for an hour, then offers it again", async () => {
		digitalocean.prices = { "s-4vcpu-8gb": 0.07, "c-4": 0.125 };
		digitalocean.stock = { nyc3: ["s-4vcpu-8gb", "c-4"] };
		digitalocean.refuseCreate =
			"You do not have access to this size: contact support to raise your limits";
		const spec = {
			id: "s-4vcpu-8gb-abc123",
			type: "s-4vcpu-8gb",
			snapshot: null,
			recipe: null,
			join: [],
			joinEnv: {},
			boot: [],
			build: null,
		};

		await expect(provider.create(spec)).rejects.toBeInstanceOf(TypeRefused);
		expect((await provider.types()).map((type) => type.name)).toEqual(["c-4"]);

		now += Duration.hrs(1).ms + 1;
		expect((await provider.types()).map((type) => type.name)).toEqual([
			"s-4vcpu-8gb",
			"c-4",
		]);
	});

	it("makes a worker tagged with its id, in the first region with stock, from the snapshot, its boot in its user data", async () => {
		digitalocean.stock = { nyc1: ["s-4vcpu-8gb"] };

		await provider.create({
			id: "s-4vcpu-8gb-abc123",
			type: "s-4vcpu-8gb",
			snapshot: "77",
			recipe: null,
			join: ["splates", "worker", "join"],
			joinEnv: { SPLATES_WORKER_JOIN: "secret-token" },
			boot: ["splates", "worker", "run", "--key-file"],
			build: null,
		});

		const [droplet] = digitalocean.tagged("splates-worker:s-4vcpu-8gb-abc123");
		expect(droplet).toMatchObject({
			name: "s-4vcpu-8gb-abc123",
			size_slug: "s-4vcpu-8gb",
			image: 77,
			region: { slug: "nyc1" },
		});
		expect(droplet?.user_data).toContain(
			"'SPLATES_WORKER_JOIN=secret-token' 'splates' 'worker' 'join'; do",
		);
		expect(droplet?.user_data).toContain(
			'ExecStart="splates" "worker" "run" "--key-file"',
		);
		expect(droplet?.user_data).not.toMatch(/ExecStart=.*secret-token/);
		expect(await provider.list()).toEqual([
			{ id: "s-4vcpu-8gb-abc123", type: "s-4vcpu-8gb" },
		]);
	});

	it("makes a worker in any region that has stock when none of its own does", async () => {
		digitalocean.stock = { sfo2: ["c-4"], lon1: ["c-4"] };

		await provider.create({
			id: "c-4-abc123",
			type: "c-4",
			snapshot: null,
			recipe: null,
			join: [],
			joinEnv: {},
			boot: [],
		});

		const [droplet] = digitalocean.tagged("splates-worker:c-4-abc123");
		expect(droplet?.region).toEqual({ slug: "lon1" });
	});

	it("makes a worker from the stock image when no snapshot is ready, running the recipe first", async () => {
		digitalocean.stock = { nyc1: ["s-4vcpu-8gb"] };

		await provider.create({
			id: "s-4vcpu-8gb-abc123",
			type: "s-4vcpu-8gb",
			snapshot: null,
			recipe: "#!/bin/sh\napt-get update\n",
			join: ["splates", "worker", "join"],
			joinEnv: {},
			boot: ["splates", "worker", "run"],
			build: null,
		});

		const [droplet] = digitalocean.tagged("splates-worker:s-4vcpu-8gb-abc123");
		expect(droplet?.image).toBe("ubuntu-24-04-x64");
		const script = droplet?.user_data ?? "";
		expect(script).toContain("apt-get update");
		expect(script.indexOf("apt-get update")).toBeLessThan(
			script.indexOf("'splates' 'worker' 'join'"),
		);
	});

	it("has a worker fetch the server's own build once joined, its token kept out of curl's arguments, and run it as its splates", async () => {
		digitalocean.stock = { nyc1: ["c-16"] };

		await provider.create({
			id: "c-16-abc123",
			type: "c-16",
			snapshot: "77",
			recipe: null,
			join: ["splates", "worker", "join"],
			joinEnv: {},
			boot: ["splates", "worker", "run"],
			build: {
				url: "https://splates.example.com/api/workers/join",
				token: "build-token",
			},
		});

		const [droplet] = digitalocean.tagged("splates-worker:c-16-abc123");
		const script = droplet?.user_data ?? "";
		const fetch = script.indexOf("curl ");
		expect(fetch).toBeGreaterThan(script.indexOf("'splates' 'worker' 'join'"));
		expect(fetch).toBeLessThan(script.indexOf("ExecStart="));
		expect(script).toContain(
			"printf '%s: %s\\n' 'x-splates-build' 'build-token' > /etc/splates-worker/build-headers",
		);
		expect(script).toContain("s/^SPLATES_WORKER_ACCESS_ID=//p");
		const curl =
			script.split("\n").find((line) => line.includes("curl ")) ?? "";
		expect(curl).toContain("-H @/etc/splates-worker/build-headers");
		expect(curl).toContain("'https://splates.example.com/api/workers/join'");
		expect(curl).not.toContain("build-token");
		expect(script).toContain(
			"ln -sf /usr/local/lib/splates/splates.js /home/splates/.bun/bin/splates",
		);
	});

	it("destroys a worker's droplet alone, and says why DigitalOcean refused one", async () => {
		const spec = {
			type: "s-4vcpu-8gb",
			snapshot: "1",
			recipe: null,
			join: [],
			joinEnv: {},
			boot: [],
			build: null,
		};
		await provider.create({ id: "w", ...spec });
		await provider.create({ id: "v", ...spec });

		await provider.destroy("w");
		await provider.destroy("gone");

		expect(await provider.list()).toEqual([{ id: "v", type: "s-4vcpu-8gb" }]);

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

	it("builds the snapshot in the region the cheapest runner would be made in, which it alone boots in", async () => {
		digitalocean.stock = {
			nyc3: ["s-1vcpu-2gb"],
			sfo2: ["c-4", "s-1vcpu-2gb"],
		};

		await provider.snapshot({
			platform: "linux",
			version: "1.2.3",
			script: "",
		});

		const builder = digitalocean.requests.find(
			(each) => each.method === "POST" && each.path === "/droplets",
		);
		expect(builder?.body).toMatchObject({ region: "sfo2" });
	});

	it("prices each snapshot by the size DigitalOcean reports at $0.06 a gigabyte a month", async () => {
		digitalocean.images.set(7, {
			id: 7,
			tags: ["splates-snapshot", "splates-snapshot:linux"],
			size_gigabytes: 5,
		});

		const images = await provider.images();

		expect(images).toHaveLength(1);
		expect(images[0]).toMatchObject({ id: "7", gigabytes: 5 });
		expect(images[0]?.dollarsPerMonth).toBeCloseTo(0.3);
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
