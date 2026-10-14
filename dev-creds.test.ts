import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OpenPortProvider } from "webappwiz/system";
import { dev } from "./dev";
import { json, post, serving } from "./dev-testing";
import { Testing } from "./testing";

/** Every file under `dir` that holds `needle`, by path. */
async function holding(dir: string, needle: string): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(dir, {
		recursive: true,
		withFileTypes: true,
	})) {
		if (entry.isFile()) {
			const path = join(entry.parentPath, entry.name);
			if ((await readFile(path)).includes(needle)) {
				found.push(path);
			}
		}
	}
	return found;
}

/**
 * That `value` is in no file of the repo (its `.git/arbor` journal and
 * record of requests included), none of arbor's home (where conversations
 * and outcomes are kept), and nothing arbor logged.
 */
async function expectNowhere(deps: Testing, value: string): Promise<void> {
	expect(await holding(deps.root, value)).toEqual([]);
	expect(await holding(dirname(deps.arborHome), value)).toEqual([]);
	expect(JSON.stringify(deps.log.entries)).not.toContain(value);
}

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

	it("keeps a filled request's value to its store alone", async () => {
		await serving(deps, async (snapshot, port) => {
			const saved = await json(port, "/api/creds/API_TOKEN", "PUT", {
				value: "tok-filled-secret",
			});

			expect(await saved.text()).not.toContain("tok-filled-secret");
			expect(await deps.deviceStore.get("API_TOKEN")).toBe("tok-filled-secret");
			expect(JSON.stringify(await snapshot())).not.toContain(
				"tok-filled-secret",
			);
			await expectNowhere(deps, "tok-filled-secret");
		});
	});

	it("keeps a value added or replaced with no request to its store alone", async () => {
		await serving(deps, async (_snapshot, port) => {
			await json(port, "/api/creds/DATABASE_URL", "PUT", {
				value: "postgres://added-secret",
				scope: "project",
			});
			await json(port, "/api/creds/DATABASE_URL", "PUT", {
				value: "postgres://replaced-secret",
				scope: "project",
			});
			const listed = await (
				await fetch(`http://127.0.0.1:${port}/api/creds`)
			).text();

			expect(await deps.projectStore.get("DATABASE_URL")).toBe(
				"postgres://replaced-secret",
			);
			expect(listed).not.toContain("secret");
			await expectNowhere(deps, "added-secret");
			await expectNowhere(deps, "replaced-secret");
		});
	});

	it("refuses a save it cannot keep, leaving the value in no refusal", async () => {
		deps.deviceStore.set = async () => {
			throw new Error("no secret service");
		};

		await serving(deps, async (snapshot, port) => {
			const unreachable = await json(port, "/api/creds/API_TOKEN", "PUT", {
				value: "tok-unreachable-secret",
			});
			const misnamed = await json(port, "/api/creds/not-a-name", "PUT", {
				value: "tok-misnamed-secret",
			});
			const misscoped = await json(port, "/api/creds/OTHER", "PUT", {
				value: "tok-misscoped-secret",
				scope: "everywhere",
			});

			expect(unreachable.status).not.toBe(200);
			expect(misnamed.status).not.toBe(200);
			expect(misscoped.status).not.toBe(200);
			const said = [
				await unreachable.text(),
				await misnamed.text(),
				await misscoped.text(),
			].join("\n");
			expect(said).not.toContain("-secret");
			expect((await snapshot()).creds).toMatchObject([{ status: "open" }]);
			expect(await deps.projectStore.names()).toEqual([]);
			await expectNowhere(deps, "-secret");
		});
	});
});
