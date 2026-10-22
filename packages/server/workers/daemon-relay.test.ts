import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodePs } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { eventually } from "../conversations/testing";
import { relayDocument } from "../records";
import { FsStorage } from "../storage";
import { WorkerDaemon } from "./daemon";

describe("WorkerDaemon's relay.json", () => {
	// What an older daemon left, which this one replaces.
	const stale = { url: "http://x:old@127.0.0.1:1", worker: "mac" };
	const run = async (direct?: { coordinator: string; keyFile: boolean }) => {
		const fs = new FakeFs();
		const relay = relayDocument(new FsStorage("/home/.splates", fs));
		await relay.write(stale);
		const daemon = new WorkerDaemon(
			{
				where: "https://splates.example.com",
				dial: () => Promise.reject(new Error("offline")),
			},
			{
				id: "mac",
				slots: 1,
				ps: new NodePs(),
				fs,
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(10), max: Duration.ms(10) },
				relay,
				...(direct === undefined ? {} : { direct }),
			},
		);
		const ran = daemon.run();
		await eventually(async () => (await relay.read())?.url !== stale.url);
		const running = await relay.read();
		await daemon.disposeAsync();
		await ran;
		return { running, stopped: await relay.read() };
	};

	it("says where its coordinator elsewhere is, and keeps it once stopped, without the relay", async () => {
		const direct = {
			coordinator: "https://splates.example.com",
			keyFile: true,
		};

		const { running, stopped } = await run(direct);

		expect(running).toMatchObject({ worker: "mac", ...direct });
		expect(running?.url).toContain("@127.0.0.1:");
		expect(stopped).toEqual({ worker: "mac", ...direct });
	});

	it("keeps no relay for this machine's own coordinator, whose server its agents reach directly", async () => {
		const { running, stopped } = await run();

		expect(running).toBeNull();
		expect(stopped).toBeNull();
	});
});
