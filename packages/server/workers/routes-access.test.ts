import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeWorkerAccess } from "../workers/testing";
import { joinAccess } from "./index";
import { DevWorkers } from "./routes";

describe("DevWorkers behind Cloudflare Access", () => {
	let access: FakeWorkerAccess;
	let workers: DevWorkers;

	beforeEach(() => {
		access = new FakeWorkerAccess();
		workers = new DevWorkers(new MemoryLogger(), { access });
	});

	afterEach(async () => {
		await workers.disposeAsync();
	});

	it("hands each invited worker a service token of its own inside the join token", async () => {
		const { token, expiresAt } = await (await workers.invite()).json();

		expect(joinAccess(token)).toEqual({
			clientId: "client-1.access",
			clientSecret: "secret-1",
		});
		expect(typeof expiresAt).toBe("number");
		expect((await join(workers, token, "box")).status).toBe(200);
		expect(workers.records.of("box")?.access).toBe("st-1");
	});

	it("revokes a removed worker's service token", async () => {
		const { token } = await (await workers.invite()).json();
		await join(workers, token, "box");

		await workers.remove(del("box"));

		expect(access.revoked).toEqual(["st-1"]);
	});

	it("revokes the old service token when a worker joins again under its id", async () => {
		await join(workers, (await (await workers.invite()).json()).token, "box");
		await join(workers, (await (await workers.invite()).json()).token, "box");

		expect(access.revoked).toEqual(["st-1"]);
		expect([...access.live.keys()]).toEqual(["st-2"]);
	});

	it("revokes the service token of an invite withdrawn unspent", async () => {
		const { token } = await (await workers.invite()).json();

		const answer = await workers.manage(
			new Request("http://127.0.0.1/api/workers/invite", {
				method: "DELETE",
				body: JSON.stringify({ token }),
			}),
			(handle) => handle,
		);

		expect(await answer.json()).toEqual({ revoked: "st-1" });
		expect(access.revoked).toEqual(["st-1"]);
		expect((await join(workers, token, "box")).status).toBe(401);
	});

	it("refuses an invite when Cloudflare will not mint a token, saying how to fix the API token", async () => {
		access.failing = new Error("POST answered 403: Authentication error");

		const answer = await workers.invite();

		expect(answer.status).toBe(502);
		expect(await answer.text()).toContain("Access: Service Tokens");
	});
});

function join(
	workers: DevWorkers,
	token: string,
	id: string,
): Promise<Response> {
	return workers.join(
		new Request("http://127.0.0.1/api/workers/join", {
			method: "POST",
			body: JSON.stringify({ token, id }),
		}),
	);
}

function del(id: string): Request {
	return new Request(`http://127.0.0.1/api/workers/${id}`, {
		method: "DELETE",
	});
}
