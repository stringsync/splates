import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { devServers } from "./dev-servers";
import { SavedTunnel } from "./saved-tunnel";
import { MACHINE_HOME, SLOT, Slots } from "./slots";

describe("devServers", () => {
	const machine = async () => {
		const fs = new FakeFs();
		const store = new FakeSecretStore();
		const secrets = { device: store, project: async () => store };
		const save = (path: string, host: string) =>
			new SavedTunnel(path, { fs, store }).save({
				host,
				team: "team",
				aud: "aud",
				tunnel: "id",
			});
		await save("/home/.arbor/tunnel.json", "arbor.example.com");
		const slots = new Slots("/home/.arbor/slots.json", {
			fs,
			ps: new FakePs(),
			lock: new MemoryLock(),
		});
		for (const tree of ["/trees/one", "/trees/two", "/trees/three"]) {
			await fs.mkdir(tree, { recursive: true });
			await slots.claim(tree);
		}
		await save("/home/.arbor/slots/cat/tunnel.json", "cat.example.com");
		await save("/home/.arbor/slots/dog/tunnel.json", "dog.example.com");
		return { fs, secrets };
	};
	const listed = async (env: Record<string, string>) => {
		const { fs, secrets } = await machine();
		const ps = new FakePs();
		ps.setEnv({ HOME: "/home", ...env });
		return devServers({ fs, ps, log: new MemoryLogger(), secrets });
	};

	it("lists the machine's own, then each slot with a host, marking the one serving", async () => {
		expect(await listed({})).toEqual([
			{
				slot: null,
				url: "https://arbor.example.com",
				tree: null,
				here: true,
			},
			{
				slot: { word: "cat", emoji: "😸" },
				url: "https://cat.example.com",
				tree: "/trees/one",
				here: false,
			},
			{
				slot: { word: "dog", emoji: "🐶" },
				url: "https://dog.example.com",
				tree: "/trees/three",
				here: false,
			},
		]);
	});

	it("reads the machine's home from a slot's server, whose own home is the slot's", async () => {
		const servers = await listed({
			ARBOR_HOME: "/home/.arbor/slots/dog",
			[SLOT]: "dog",
			[MACHINE_HOME]: "/home/.arbor",
		});

		expect(servers.map(({ url, here }) => [url, here])).toEqual([
			["https://arbor.example.com", false],
			["https://cat.example.com", false],
			["https://dog.example.com", true],
		]);
	});
});
