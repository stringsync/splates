import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MovedCreds } from "./creds";
import { movedProjects } from "./paths";

describe("MovedCreds", () => {
	it("carries the device's but the dev slots' tunnels, and each project's by its box root", async () => {
		const creds = new MovedCreds({
			device: new FakeSecretStore({
				SPLATES_TUNNEL_TOKEN: "tunnel",
				SPLATES_SLOT_OWL_TUNNEL_TOKEN: "owl",
			}),
			project: async (root) =>
				new FakeSecretStore(
					root.endsWith("splates") ? { TYPESAFE_API_KEY: "typesafe" } : {},
				),
		});

		const carried = await creds.carried(
			movedProjects([
				{ slug: "splates", root: "/Users/me/Projects/splates" },
				{ slug: "mdom", root: "/Users/me/Projects/mdom" },
			]),
		);

		expect(carried).toEqual({
			device: { SPLATES_TUNNEL_TOKEN: "tunnel" },
			projects: {
				"/home/splates/projects/splates": { TYPESAFE_API_KEY: "typesafe" },
			},
		});
	});

	it("keeps what it carried in the box's stores", async () => {
		const device = new FakeSecretStore();
		const project = new FakeSecretStore();

		const kept = await new MovedCreds({
			device,
			project: async () => project,
		}).keep({
			device: { SPLATES_TUNNEL_TOKEN: "tunnel" },
			projects: {
				"/home/splates/projects/splates": { TYPESAFE_API_KEY: "typesafe" },
			},
		});

		expect(kept).toBe(2);
		expect(device.values).toEqual(
			new Map([["SPLATES_TUNNEL_TOKEN", "tunnel"]]),
		);
		expect(project.values).toEqual(new Map([["TYPESAFE_API_KEY", "typesafe"]]));
	});
});
