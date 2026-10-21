import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { deployKey, neededCreds } from "./creds";

/** Stores whose project creds are by the clone's name. */
function stores(
	device: Record<string, string>,
	projects: Record<string, Record<string, string>>,
) {
	return {
		device: new FakeSecretStore(device),
		project: async (root: string) =>
			new FakeSecretStore(
				projects[root.slice(root.lastIndexOf("/") + 1)] ?? {},
			),
	};
}

describe("the creds the box needs", () => {
	it("names none once the tunnel token and every deploy key are there", async () => {
		const kept = stores(
			{ SPLATES_TUNNEL_TOKEN: "t" },
			{ splates: { SPLATES_DEPLOY_KEY: "key" } },
		);

		expect(await neededCreds(kept, ["/home/splates/projects/splates"])).toEqual(
			[],
		);
	});

	it("names the tunnel token and each project's deploy key it lacks", async () => {
		const kept = stores({}, { splates: { SPLATES_DEPLOY_KEY: "key" } });

		const missing = await neededCreds(kept, [
			"/home/splates/projects/splates",
			"/home/splates/projects/mdom",
		]);

		expect(missing[0]).toBe("/splates/device/SPLATES_TUNNEL_TOKEN");
		expect(missing).toHaveLength(2);
		expect(missing[1]).toStartWith("SPLATES_DEPLOY_KEY in ");
	});

	it("reads a project's deploy key", async () => {
		const kept = stores({}, { splates: { SPLATES_DEPLOY_KEY: "key" } });

		expect(await deployKey(kept, "/home/splates/projects/splates")).toBe("key");
		expect(
			await deployKey(kept, "/home/splates/projects/mdom"),
		).toBeUndefined();
	});
});
