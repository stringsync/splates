import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { FsStorage } from "../storage";
import { MemoryStorage } from "../storage/testing";
import { asideOf, machineTunnel } from "./machine";
import { SavedTunnel } from "./saved";

describe("machineTunnel", () => {
	const home = "/home/.splates";
	const setup = () => {
		const fs = new FakeFs();
		const store = new FakeSecretStore();
		const save = (dir: string, host: string) =>
			SavedTunnel.in(new FsStorage(`${dir}`, fs), store).save({
				host,
				team: "team",
				aud: "aud",
				tunnel: "id",
			});
		const read = () => machineTunnel({ fs, home, store });
		return { fs, save, read };
	};

	it("reads the machine's own tunnel", async () => {
		const { save, read } = setup();
		await save(home, "splates.example.com");
		await save(asideOf(home, "2026-01-01T00-00-00-000Z"), "old.example.com");

		expect((await read())?.host).toBe("splates.example.com");
	});

	it("reads the tunnel the last move put aside once the coordinator moved", async () => {
		const { save, read } = setup();
		await save(asideOf(home, "2026-01-01T00-00-00-000Z"), "old.example.com");
		await save(asideOf(home, "2026-10-18T09-30-00-000Z"), "box.example.com");

		expect((await read())?.host).toBe("box.example.com");
	});

	it("finds the last moved tunnel without filesystem access", async () => {
		const storage = new MemoryStorage();
		const store = new FakeSecretStore();
		await SavedTunnel.in(storage.within("moved-2026-01-01"), store).save({
			host: "old.example.com",
			team: "team",
			aud: "aud",
			tunnel: "id",
		});
		await SavedTunnel.in(storage.within("moved-2026-10-18"), store).save({
			host: "box.example.com",
			team: "team",
			aud: "aud",
			tunnel: "id",
		});
		await storage.collection("").write("moved-2099", "a file, not a directory");
		expect(
			(await machineTunnel({ fs: new FakeFs(), home, store, storage }))?.host,
		).toBe("box.example.com");
	});

	it("is null when the machine never had one", async () => {
		const { fs, read } = setup();
		await fs.mkdir(home, { recursive: true });

		expect(await read()).toBeNull();
	});
});
