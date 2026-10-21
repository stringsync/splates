import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { ChosenCloud } from "./index";

const HOME = "/home/.splates";

describe("ChosenCloud", () => {
	it("takes DigitalOcean, where boxes were made before setup asked, until one is chosen", async () => {
		const chosen = new ChosenCloud(HOME, new FakeFs());

		expect(await chosen.read()).toBeNull();
		expect((await chosen.cloud({ store: new FakeSecretStore() })).name).toBe(
			"DigitalOcean",
		);
	});

	it("keeps the cloud chosen, refusing one not offered", async () => {
		const fs = new FakeFs();
		const chosen = new ChosenCloud(HOME, fs);

		await expect(chosen.choose("aws")).rejects.toThrow(
			"splates offers no cloud 'aws'",
		);
		await chosen.choose("digitalocean");

		expect(await new ChosenCloud(HOME, fs).read()).toBe("digitalocean");
	});

	it("forgets the cloud chosen once cleared, and clears none twice", async () => {
		const fs = new FakeFs();
		const chosen = new ChosenCloud(HOME, fs);
		await chosen.choose("digitalocean");

		await chosen.clear();
		await chosen.clear();

		expect(await chosen.read()).toBeNull();
	});

	it("forgets a cloud no longer offered", async () => {
		const fs = new FakeFs();
		await fs.mkdir(HOME, { recursive: true });
		await fs.write(`${HOME}/cloud.json`, '{"format":1,"cloud":"gone"}');

		expect(await new ChosenCloud(HOME, fs).read()).toBeNull();
	});
});
