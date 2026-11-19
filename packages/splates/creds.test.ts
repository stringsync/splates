import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "@splates/server/testing";
import { splates } from "./splates";

const WHY = "To read the build logs through the dashboard's API.";
const HOW = "Open the dashboard, create a token, and paste it here.";

describe("creds", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("records a request, with what for and how to get it, for the page to show", async () => {
		await deps.creds.request("API_TOKEN", {
			scope: "device",
			purpose: WHY,
			instructions: HOW,
			task: "alpha",
		});

		expect(await deps.creds.requests()).toMatchObject([
			{
				name: "API_TOKEN",
				scope: "device",
				purpose: WHY,
				instructions: HOW,
				task: "alpha",
				status: "open",
			},
		]);
	});

	it("asks nothing for a cred already kept, unless told the kept one fails", async () => {
		await deps.projectStore.set("API_TOKEN", "old");
		const ask = {
			scope: "project" as const,
			purpose: WHY,
			instructions: HOW,
			task: null,
		};

		expect(await deps.creds.request("API_TOKEN", ask)).toBeNull();
		expect(
			await deps.creds.request("API_TOKEN", { ...ask, replace: true }),
		).toMatchObject({ status: "open" });
	});

	it("replaces with the last request's purpose and instructions when left off", async () => {
		const ask = {
			scope: "project" as const,
			purpose: WHY,
			instructions: HOW,
			task: null,
		};
		await deps.creds.request("API_TOKEN", ask);
		await deps.projectStore.set("API_TOKEN", "old");

		expect(
			await deps.creds.request("API_TOKEN", {
				scope: "project",
				purpose: "",
				instructions: "",
				task: null,
				replace: true,
			}),
		).toMatchObject({ purpose: WHY, instructions: HOW, status: "open" });
	});

	it("refuses a request that says nothing of what it is for", async () => {
		await expect(
			deps.creds.request("API_TOKEN", {
				scope: "project",
				purpose: " ",
				instructions: HOW,
				task: null,
			}),
		).toBail("usage");
	});

	it("refuses a request that says nothing of how to get it", async () => {
		await expect(
			deps.creds.request("API_TOKEN", {
				scope: "project",
				purpose: WHY,
				instructions: " ",
				task: null,
			}),
		).toBail("usage");
	});

	it("refuses a name no environment variable could have", async () => {
		await expect(
			deps.creds.request("api-token", {
				scope: "project",
				purpose: WHY,
				instructions: HOW,
				task: null,
			}),
		).toBail("usage");
	});

	it("keeps a value in the store its request asked for, and fills it", async () => {
		await deps.creds.request("API_TOKEN", {
			scope: "device",
			purpose: WHY,
			instructions: HOW,
			task: null,
		});

		expect(await deps.creds.save("API_TOKEN", " secret \n")).toBe("device");

		expect(await deps.deviceStore.get("API_TOKEN")).toBe("secret");
		expect(await deps.projectStore.get("API_TOKEN")).toBeUndefined();
		expect((await deps.creds.requests())[0]?.status).toBe("saved");
		expect(await deps.creds.credentials.require("API_TOKEN")).toBe("secret");
	});

	it("never writes a value into its record", async () => {
		await deps.creds.request("API_TOKEN", {
			scope: "project",
			purpose: WHY,
			instructions: HOW,
			task: null,
		});
		await deps.creds.save("API_TOKEN", "hunter2", { by: "a tool" });

		expect(await deps.readRecord("creds.json")).not.toContain("hunter2");
	});

	it("lists what each store keeps, and what a tool saved itself", async () => {
		await deps.projectStore.set("DATABASE_URL", "x");
		await deps.creds.save("TUNNEL_TOKEN", "y", {
			scope: "device",
			by: "splates tunnel setup",
		});

		expect(await deps.creds.kept()).toEqual([
			{
				name: "DATABASE_URL",
				scope: "project",
				provider: "system",
				savedBy: null,
			},
			{
				name: "TUNNEL_TOKEN",
				scope: "device",
				provider: "system",
				savedBy: "splates tunnel setup",
			},
		]);
	});

	it("removes a kept cred from its store", async () => {
		await deps.creds.save("TUNNEL_TOKEN", "y", { scope: "device", by: "t" });

		expect(await deps.creds.remove("TUNNEL_TOKEN", "device")).toBe(true);
		expect(await deps.creds.kept()).toEqual([]);
	});

	it("says the system keeps no secrets when its store cannot be reached", async () => {
		deps.projectStore.names = () => Promise.reject(new Error("no daemon"));

		await expect(deps.creds.kept()).toBail("no_secret_store", {
			message: "secret service",
		});
	});
});

// vet-ignore simple-test-setup: one describe per command, as the file groups the CLI's cases
describe("splates creds", () => {
	let env: Testing;
	let deps: Parameters<typeof splates.run>[0];

	beforeEach(async () => {
		env = await Testing.open();
		env.ps.cd(env.root);
		deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
			secrets: env.secrets,
		};
	});

	afterEach(() => env.disposeAsync());

	it("requests a cred and prints where it shows", async () => {
		await splates.run(deps, [
			"creds",
			"request",
			"API_TOKEN",
			"--purpose",
			WHY,
			"--instructions",
			HOW,
			"--device",
		]);

		expect(env.out()).toContain(`requested API_TOKEN  ${WHY}`);
	});

	it("lists requests and kept creds by name, never a value", async () => {
		await env.projectStore.set("DATABASE_URL", "postgres://secret");
		await splates.run(deps, [
			"creds",
			"request",
			"API_TOKEN",
			"--purpose",
			WHY,
			"--instructions",
			HOW,
		]);

		await splates.run(deps, ["creds", "list", "--json"]);

		const listed = String(env.log.entries.at(-1)?.message);
		expect(JSON.parse(listed)).toMatchObject({
			requested: [{ name: "API_TOKEN", status: "open" }],
			kept: [{ name: "DATABASE_URL", scope: "project" }],
		});
		expect(listed).not.toContain("postgres://secret");
	});
});

// vet-ignore simple-test-setup: copyLegacy reads a store the other commands never touch
describe("copyLegacy", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("keeps each of arbor's creds under splates's name too, in the same store", async () => {
		await deps.deviceStore.set("ARBOR_CLOUDFLARE_API_TOKEN", "secret");

		await deps.creds.copyLegacy();

		expect(await deps.deviceStore.names()).toEqual([
			"ARBOR_CLOUDFLARE_API_TOKEN",
			"SPLATES_CLOUDFLARE_API_TOKEN",
		]);
	});

	it("leaves a cred splates already keeps", async () => {
		await deps.deviceStore.set("ARBOR_TUNNEL_TOKEN", "old");
		await deps.deviceStore.set("SPLATES_TUNNEL_TOKEN", "new");

		await deps.creds.copyLegacy();

		expect(await deps.deviceStore.get("SPLATES_TUNNEL_TOKEN")).toBe("new");
	});
});
