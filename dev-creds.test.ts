import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { dev } from "./dev";
import { json, post, serving } from "./dev-testing";
import { Testing } from "./testing";

describe("dev creds", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
		await deps.creds.request("API_TOKEN", {
			scope: "device",
			instructions: "Make one and paste it.",
			task: null,
		});
	});

	afterEach(() => deps.disposeAsync());

	it("shows requests in the snapshot, and fills one into the store it asked for", async () => {
		await serving(deps, async (snapshot, port) => {
			expect((await snapshot()).creds).toMatchObject([
				{ name: "API_TOKEN", status: "open" },
			]);

			const saved = await json(port, "/api/creds/API_TOKEN", "PUT", {
				value: "secret",
			});

			expect(saved.status).toBe(200);
			expect(await deps.deviceStore.get("API_TOKEN")).toBe("secret");
			const after = await snapshot();
			expect(after.creds).toMatchObject([{ status: "saved" }]);
			expect(JSON.stringify(after)).not.toContain("secret");
		});
	});

	it("lists what is kept by name, never a value", async () => {
		await deps.projectStore.set("DATABASE_URL", "postgres://secret");

		await serving(deps, async (_snapshot, port) => {
			const listed = await (
				await fetch(`http://127.0.0.1:${port}/api/creds`)
			).text();

			expect(JSON.parse(listed)).toEqual({
				kept: [{ name: "DATABASE_URL", scope: "project", savedBy: null }],
				labels: {
					project: "the project's store",
					device: "the device's store",
				},
			});
			expect(listed).not.toContain("postgres://secret");
		});
	});

	it("removes a kept cred, and dismisses a request", async () => {
		await deps.projectStore.set("DATABASE_URL", "x");

		await serving(deps, async (snapshot, port) => {
			const removed = await json(
				port,
				"/api/creds/DATABASE_URL?scope=project",
				"DELETE",
			);
			const dismissed = await post(port, "/api/creds/API_TOKEN/dismiss", "");

			expect([removed.status, dismissed.status]).toEqual([200, 200]);
			expect(await deps.projectStore.names()).toEqual([]);
			expect((await snapshot()).creds).toMatchObject([{ status: "dismissed" }]);
		});
	});

	it("refuses a tunnel's host without Access, as it does conversations", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			hosts: ["repo.arbor.example"],
		});
		try {
			const saved = await fetch(
				`http://127.0.0.1:${server.port}/api/creds/API_TOKEN`,
				{
					method: "PUT",
					headers: {
						host: "repo.arbor.example",
						origin: "http://repo.arbor.example",
						"content-type": "application/json",
					},
					body: JSON.stringify({ value: "secret" }),
				},
			);

			expect(saved.status).toBe(403);
			expect(await deps.deviceStore.get("API_TOKEN")).toBeUndefined();
		} finally {
			await server.disposeAsync();
		}
	});
});
