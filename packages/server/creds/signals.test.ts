import { describe, expect, it } from "bun:test";
import type { Project, ProjectWatch } from "../server/shared";
import { CredRoutes } from "./routes";

/** Routes over a project whose creds save and dismiss as given. */
function routes(raised: [string, unknown][]): CredRoutes {
	const project = {
		journal: { record: (_: string, __: null, run: () => unknown) => run() },
		creds: { save: async () => "device", dismiss: async () => {} },
	} as unknown as Project;
	const watch = { tick: () => {} } as unknown as ProjectWatch;
	return new CredRoutes(project, watch, async (name, payload) => {
		raised.push([name, payload]);
	});
}

const put = (name: string, body: object) =>
	new Request(`http://x/api/creds/${name}`, {
		method: "PUT",
		body: JSON.stringify(body),
	});

describe("cred signals", () => {
	it("raises cred.saved with the name and scope, never the value", async () => {
		const raised: [string, unknown][] = [];
		await routes(raised).saveCred(put("API_TOKEN", { value: "s3cret" }));
		expect(raised).toEqual([
			["cred.saved/API_TOKEN", { name: "API_TOKEN", scope: "device" }],
		]);
		expect(JSON.stringify(raised)).not.toContain("s3cret");
	});

	it("raises cred.dismissed when a request is turned down", async () => {
		const raised: [string, unknown][] = [];
		await routes(raised).dismissCred(
			new Request("http://x/api/creds/API_TOKEN/dismiss", { method: "POST" }),
		);
		expect(raised).toEqual([
			["cred.dismissed/API_TOKEN", { name: "API_TOKEN" }],
		]);
	});
});
