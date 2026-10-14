import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration, sleep } from "webappwiz/time";
import { arbor } from "./arbor";
import { Testing } from "./testing";

const HOW = "Open the dashboard, create a token, and paste it here.";

/** Long enough that a test only reaches it when waiting is genuinely stuck. */
const PATIENT = { timeout: Duration.secs(5), poll: Duration.ms(5) };

describe("creds", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("records a request, with how to get it, for the page to show", async () => {
		await deps.creds.request("API_TOKEN", {
			scope: "device",
			instructions: HOW,
			task: "alpha",
		});

		expect(await deps.creds.requests()).toMatchObject([
			{
				name: "API_TOKEN",
				scope: "device",
				instructions: HOW,
				task: "alpha",
				status: "open",
			},
		]);
	});

	it("asks nothing for a cred already kept, unless told the kept one fails", async () => {
		await deps.projectStore.set("API_TOKEN", "old");
		const ask = { scope: "project" as const, instructions: HOW, task: null };

		expect(await deps.creds.request("API_TOKEN", ask)).toBeNull();
		expect(
			await deps.creds.request("API_TOKEN", { ...ask, replace: true }),
		).toMatchObject({ status: "open" });
	});

	it("refuses a request that says nothing of how to get it", async () => {
		await expect(
			deps.creds.request("API_TOKEN", {
				scope: "project",
				instructions: " ",
				task: null,
			}),
		).toBail("usage");
	});

	it("refuses a name no environment variable could have", async () => {
		await expect(
			deps.creds.request("api-token", {
				scope: "project",
				instructions: HOW,
				task: null,
			}),
		).toBail("usage");
	});

	it("keeps a value in the store its request asked for, and fills it", async () => {
		await deps.creds.request("API_TOKEN", {
			scope: "device",
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
			instructions: HOW,
			task: null,
		});
		await deps.creds.save("API_TOKEN", "hunter2", { by: "a tool" });

		expect(await deps.fs.read(deps.creds.file)).not.toContain("hunter2");
	});

	it("ends a wait once the value is saved", async () => {
		await deps.creds.request("API_TOKEN", {
			scope: "project",
			instructions: HOW,
			task: null,
		});

		const waiting = deps.creds.wait("API_TOKEN", PATIENT);
		await sleep(Duration.ms(20));
		await deps.creds.save("API_TOKEN", "secret");

		expect(await waiting).toBe("saved");
	});

	it("ends a wait once the request is dismissed", async () => {
		await deps.creds.request("API_TOKEN", {
			scope: "project",
			instructions: HOW,
			task: null,
		});
		await deps.creds.dismiss("API_TOKEN");

		expect(await deps.creds.wait("API_TOKEN", PATIENT)).toBe("dismissed");
	});

	it("gives up waiting on a request nobody fills", async () => {
		await deps.creds.request("API_TOKEN", {
			scope: "project",
			instructions: HOW,
			task: null,
		});

		await expect(
			deps.creds.wait("API_TOKEN", {
				timeout: Duration.ms(20),
				poll: Duration.ms(5),
			}),
		).toBail("timeout");
	});

	it("refuses to wait on a cred nothing requested", async () => {
		await expect(deps.creds.wait("API_TOKEN", PATIENT)).toBail("not_found");
	});

	it("lists what each store keeps, and what a tool saved itself", async () => {
		await deps.projectStore.set("DATABASE_URL", "x");
		await deps.creds.save("TUNNEL_TOKEN", "y", {
			scope: "device",
			by: "arbor tunnel setup",
		});

		expect(await deps.creds.kept()).toEqual([
			{ name: "DATABASE_URL", scope: "project", savedBy: null },
			{ name: "TUNNEL_TOKEN", scope: "device", savedBy: "arbor tunnel setup" },
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

describe("arbor creds", () => {
	let env: Testing;
	let deps: Parameters<typeof arbor.run>[0];

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

	it("requests a cred, then waits until a person saves it", async () => {
		await arbor.run(deps, [
			"creds",
			"request",
			"API_TOKEN",
			"--instructions",
			HOW,
			"--device",
		]);
		expect(env.out()).toContain("requested API_TOKEN");

		const waiting = arbor.run(deps, ["creds", "wait", "API_TOKEN"]);
		await sleep(Duration.ms(20));
		await env.creds.save("API_TOKEN", "secret");
		await waiting;

		expect(env.out()).toContain("saved API_TOKEN");
		expect(await env.deviceStore.get("API_TOKEN")).toBe("secret");
	});

	it("exits dismissed when the person turns the request down", async () => {
		await arbor.run(deps, [
			"creds",
			"request",
			"API_TOKEN",
			"--instructions",
			HOW,
		]);
		await env.creds.dismiss("API_TOKEN");

		await arbor.run(deps, ["creds", "wait", "API_TOKEN"]);

		expect(env.proc.exits).toEqual([22]);
	});

	it("lists requests and kept creds by name, never a value", async () => {
		await env.projectStore.set("DATABASE_URL", "postgres://secret");
		await arbor.run(deps, [
			"creds",
			"request",
			"API_TOKEN",
			"--instructions",
			HOW,
		]);

		await arbor.run(deps, ["creds", "list", "--json"]);

		const listed = String(env.log.entries.at(-1)?.message);
		expect(JSON.parse(listed)).toMatchObject({
			requested: [{ name: "API_TOKEN", status: "open" }],
			kept: [{ name: "DATABASE_URL", scope: "project" }],
		});
		expect(listed).not.toContain("postgres://secret");
	});
});
