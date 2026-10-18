import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { joinAccess } from "./access";
import { JOIN_WITHIN, WorkerRecords } from "./records";

const PATH = "/home/.splates/workers.json";

describe("WorkerRecords", () => {
	it("lets a worker join with a token, once, and knows it by the key it is answered", async () => {
		const records = WorkerRecords.memory();
		const { token } = await records.invite();

		const key = await records.join(token, "box");

		expect(key).not.toBeNull();
		expect(records.verify("box", key ?? "")).toBe(true);
		expect(records.verify("box", "another")).toBe(false);
		expect(records.verify("other", key ?? "")).toBe(false);
		expect(await records.join(token, "again")).toBeNull();
	});

	it("refuses a token past its 15 minutes", async () => {
		const wall = new FakeWallClock(0);
		const records = WorkerRecords.memory(wall);
		const { token } = await records.invite();
		wall.advance(JOIN_WITHIN.add(Duration.secs(1)));

		expect(await records.join(token, "box")).toBeNull();
	});

	it("revokes the old key when a worker joins again under its id", async () => {
		const records = WorkerRecords.memory();
		const old = await records.join((await records.invite()).token, "box");
		const fresh = await records.join((await records.invite()).token, "box");

		expect(records.verify("box", old ?? "")).toBe(false);
		expect(records.verify("box", fresh ?? "")).toBe(true);
	});

	it("keeps workers, settings and unspent tokens, never a key or token, across a reopen", async () => {
		const fs = new FakeFs();
		const records = await WorkerRecords.open(PATH, fs);
		const key = await records.join((await records.invite()).token, "box");
		await records.set("box", { slots: 3, draining: true });
		const { token } = await records.invite();

		const reopened = await WorkerRecords.open(PATH, fs);
		const file = await fs.read(PATH);

		expect(reopened.verify("box", key ?? "")).toBe(true);
		expect(reopened.of("box")).toMatchObject({ slots: 3, draining: true });
		expect(await reopened.join(token, "next")).not.toBeNull();
		expect(file).not.toContain(key ?? "");
		expect(file).not.toContain(token);
	});

	it("revokes a removed worker's key", async () => {
		const records = WorkerRecords.memory();
		const key = await records.join((await records.invite()).token, "box");

		expect(await records.remove("box")).toMatchObject({ id: "box" });
		expect(records.verify("box", key ?? "")).toBe(false);
	});

	it("hands a service token on in the join token, and keeps its id with the worker that spends it", async () => {
		const records = WorkerRecords.memory();
		const access = {
			id: "st-1",
			clientId: "client.access",
			clientSecret: "secret",
		};
		const { token } = await records.invite(access);

		expect(joinAccess(token)).toEqual({
			clientId: "client.access",
			clientSecret: "secret",
		});
		expect(await records.join(token, "box")).not.toBeNull();
		expect(records.of("box")?.access).toBe("st-1");
	});

	it("answers the service tokens of join tokens run out unused, once", async () => {
		const wall = new FakeWallClock(0);
		const records = WorkerRecords.memory(wall);
		await records.invite({ id: "st-1", clientId: "c", clientSecret: "s" });
		await records.invite();
		wall.advance(JOIN_WITHIN.add(Duration.secs(1)));
		await records.invite();

		expect(await records.sweep()).toEqual(["st-1"]);
		expect(await records.sweep()).toEqual([]);
	});
});
