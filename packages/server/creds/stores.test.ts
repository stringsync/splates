import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySecretStore } from "webappwiz/creds";
import { NodeFs } from "webappwiz/system";
import { Imds } from "./imds";
import { cannotReach, systemStores } from "./stores";

describe("systemStores with SPLATES_SECRET_STORE=file", () => {
	let home: string;

	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "splates-file-stores-"));
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	test("keeps the device's and each project's in files only this user may read", async () => {
		const stores = systemStores({
			platform: "linux",
			choice: "file",
			home,
			fs: new NodeFs(),
			// The metadata service is never asked.
			imds: new Imds({
				fetch: (async () => {
					throw new Error("asked the metadata service");
				}) as unknown as typeof fetch,
			}),
		});
		await stores.device.set("K", "v");
		await (await stores.project(home)).set("P", "w");

		expect(await stores.device.get("K")).toBe("v");
		expect((await stat(`${home}/secrets/device.env`)).mode & 0o777).toBe(0o600);
		expect(await (await stores.project(home)).get("P")).toBe("w");
		expect(await stores.device.get("P")).toBeUndefined();
		expect(stores.ssm).toBeDefined();
	});

	test("is what a machine whose store cannot be reached is told of", () => {
		const said = cannotReach(
			new MemorySecretStore("the machine's secret store"),
			new Error("libsecret not available"),
		);

		expect(said).toContain("libsecret not available");
		expect(said).toContain("SPLATES_SECRET_STORE=file");
	});
});
