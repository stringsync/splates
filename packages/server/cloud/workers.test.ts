import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { Duration } from "webappwiz/time";
import { HCLOUD_TOKEN, HetznerCloud } from "./index";
import { FakeHetzner } from "./testing";
import { CloudWorkers } from "./workers";

describe("CloudWorkers in Hetzner", () => {
	let hetzner: FakeHetzner;
	let store: FakeSecretStore;
	let stuck: boolean;
	let now: number;
	let provider: CloudWorkers;

	beforeEach(async () => {
		hetzner = new FakeHetzner();
		hetzner.actionsRun = true;
		hetzner.stock = {
			nbg1: ["cpx62", "cpx22"],
			fsn1: ["cpx62", "cx53", "cpx22"],
		};
		store = new FakeSecretStore();
		await store.set(HCLOUD_TOKEN, "token");
		stuck = false;
		now = 1000;
		const wait = async () => {
			if (!stuck) {
				for (const builder of hetzner.labelled("splates-snapshot-builder")) {
					builder.status = "off";
				}
			}
		};
		provider = new CloudWorkers(
			new HetznerCloud({ store, fetch: hetzner.fetch, wait }),
			{ wall: { now: () => now }, wait },
		);
	});

	it("offers the CX53 only while one of its locations can make it", async () => {
		expect((await provider.types()).map((type) => type.name)).toEqual([
			"cx53",
			"cpx62",
		]);

		hetzner.stock.fsn1 = ["cpx62"];
		expect((await provider.types()).map((type) => type.name)).toEqual([
			"cpx62",
		]);
	});

	it("makes a worker labelled with its id, in the first location with stock, its join and boot in its user data", async () => {
		const made = await provider.create({
			id: "cx53-abc123",
			type: "cx53",
			snapshot: "77",
			join: ["splates", "worker", "join", "--join", "secret-token"],
			boot: ["splates", "worker", "run", "--key-file"],
		});

		expect(made).toEqual({ id: "cx53-abc123", type: "cx53" });
		const [server] = hetzner.labelled("splates-worker=cx53-abc123");
		expect(server).toMatchObject({
			name: "cx53-abc123",
			server_type: { name: "cx53" },
			image: "77",
			datacenter: { location: { name: "fsn1" } },
		});
		expect(server?.user_data).toContain(
			"SPLATES_HOME=/etc/splates-worker 'splates' 'worker' 'join' '--join' 'secret-token'; do",
		);
		expect(server?.user_data).toContain(
			"EnvironmentFile=/etc/splates-worker/worker.env",
		);
		expect(server?.user_data).toContain(
			'ExecStart="splates" "worker" "run" "--key-file"',
		);
	});

	it("makes a worker once, however often it is asked", async () => {
		const spec = { id: "w", type: "cpx62", snapshot: "1", join: [], boot: [] };
		await provider.create(spec);
		await provider.create(spec);

		expect(hetzner.labelled("splates-worker")).toHaveLength(1);
	});

	it("refuses a type no location can make, and says why Hetzner refused one", async () => {
		hetzner.stock = { nbg1: ["cpx62"] };
		await expect(
			provider.create({
				id: "w",
				type: "cx53",
				snapshot: "1",
				join: [],
				boot: [],
			}),
		).rejects.toThrow("Hetzner Cloud cannot make a cx53 in nbg1, fsn1, hel1");

		hetzner.refuseCreate = "server limit reached";
		await expect(
			provider.create({
				id: "w",
				type: "cpx62",
				snapshot: "1",
				join: [],
				boot: [],
			}),
		).rejects.toThrow("server limit reached");
		expect(hetzner.servers.size).toBe(0);
	});

	it("destroys a worker's server, and nothing for a worker it never made", async () => {
		await provider.create({
			id: "w",
			type: "cpx62",
			snapshot: "1",
			join: [],
			boot: [],
		});
		await provider.create({
			id: "v",
			type: "cpx62",
			snapshot: "1",
			join: [],
			boot: [],
		});

		await provider.destroy("w");
		await provider.destroy("gone");

		expect(await provider.list()).toEqual([{ id: "v", type: "cpx62" }]);
	});

	it("lists the servers labelled as its workers", async () => {
		await provider.create({
			id: "cpx62-aaaaaa",
			type: "cpx62",
			snapshot: "1",
			join: [],
			boot: [],
		});

		expect(await provider.list()).toEqual([
			{ id: "cpx62-aaaaaa", type: "cpx62" },
		]);
	});

	it("builds a snapshot on a small builder once the recipe powers it off, then lets the builder and the last snapshot go", async () => {
		hetzner.images.set(7, { id: 7, labels: { "splates-snapshot": "linux" } });

		const snapshot = await provider.snapshot({
			platform: "linux",
			version: "1.2.3",
			script: "#!/bin/sh\necho recipe\n",
		});

		const builder = hetzner.requests.find(
			(each) => each.method === "POST" && each.path === "/servers",
		);
		expect(builder?.body).toMatchObject({
			server_type: "cpx22",
			image: "ubuntu-24.04",
		});
		expect(String(builder?.body?.user_data)).toContain("echo recipe");
		const imaged = hetzner.requests.find((each) =>
			each.path.endsWith("/actions/create_image"),
		);
		expect(imaged?.body).toMatchObject({
			type: "snapshot",
			description: "splates 1.2.3 worker",
		});
		expect(hetzner.servers.size).toBe(0);
		expect([...hetzner.images.keys()].map(String)).toEqual([snapshot.id]);
		expect(snapshot).toMatchObject({ version: "1.2.3", builtAt: 1000 });
	});

	it("lets the builder go, keeping the last snapshot, when the recipe never finishes", async () => {
		stuck = true;
		hetzner.images.set(7, { id: 7, labels: { "splates-snapshot": "linux" } });

		await expect(
			provider.snapshot({ platform: "linux", version: "1.2.3", script: "" }),
		).rejects.toThrow("did not finish within 40 minutes");

		expect(hetzner.servers.size).toBe(0);
		expect([...hetzner.images.keys()]).toEqual([7]);
	});

	it("clears a builder a build that died left, before building again", async () => {
		hetzner.put({
			name: "linux-snapshot-builder",
			labels: { "splates-snapshot-builder": "linux" },
		});

		await provider.snapshot({
			platform: "linux",
			version: "1.2.3",
			script: "",
		});

		expect(hetzner.servers.size).toBe(0);
	});

	it("sweeps a snapshot builder only once it is older than any build", async () => {
		const labels = { "splates-snapshot-builder": "linux" };
		hetzner.put({ name: "old", labels, created: new Date(0).toISOString() });
		hetzner.put({
			name: "young",
			labels,
			created: new Date(Duration.mins(170).ms).toISOString(),
		});
		now = Duration.hrs(3).ms;

		expect(await provider.sweep()).toEqual(["the snapshot builder old"]);
		expect([...hetzner.servers.values()].map((server) => server.name)).toEqual([
			"young",
		]);
	});

	it("names the setup step when it has no token", async () => {
		await store.delete(HCLOUD_TOKEN);

		await expect(provider.types()).rejects.toThrow(
			"do the setup step `cloud-token`",
		);
	});
});
