import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import type { ReplicaPlace, ReplicaStatus } from "../replica";
import { REPLICA_AREA } from "./area-replica";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

const BUCKET: ReplicaPlace = {
	provider: "s3",
	endpoint: "https://store.example.com",
	bucket: "records",
	prefix: "/splates/",
};

const CAUGHT_UP: ReplicaStatus = {
	replica: "s3://records/splates",
	caughtUpAt: Date.now() - 60_000,
	pending: 0,
	behindSince: null,
	error: null,
};

describe("REPLICA_AREA", () => {
	let machine: SetupMachine;
	let place: ReplicaPlace | null;
	let status: ReplicaStatus | null;
	let kept: Set<string>;

	beforeEach(async () => {
		place = null;
		status = null;
		kept = new Set();
		machine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore(),
			project: {
				root: "/repo",
				config: async () => ({
					trunk: "main",
					remote: null,
					workerProvider: null,
					replica: place,
				}),
				remoteUrl: async () => null,
				replica: async () => status,
				kept: async (name) => kept.has(name),
			},
		};
		await machine.fs.mkdir(HOME, { recursive: true });
	});

	async function steps() {
		const progress = await new Setup(machine, [REPLICA_AREA]).read();
		return Object.fromEntries(
			progress.areas[0]?.steps.map((step) => [step.id, step]) ?? [],
		);
	}

	it("asks for a replica in splates.config.ts while none is named", async () => {
		const { "replica-place": named, replica } = await steps();

		expect(named).toMatchObject({ status: "ready", detail: null });
		expect(named?.user).toContain('provider: "s3"');
		expect(replica).toMatchObject({ status: "waiting", detail: null });
	});

	it("says where a named bucket is and asks for its key on the Creds page", async () => {
		place = BUCKET;

		const { "replica-place": named, "replica-creds": creds } = await steps();

		expect(named).toMatchObject({
			status: "done",
			detail: "Named: `s3://records/splates`.",
		});
		expect(creds?.status).toBe("ready");
		expect(creds?.user).toContain("[Creds page](#creds)");
	});

	it("is done with the key once both creds are kept", async () => {
		place = BUCKET;
		kept = new Set(["REPLICA_ACCESS_KEY", "REPLICA_SECRET_KEY"]);

		expect((await steps())["replica-creds"]?.status).toBe("done");
	});

	it("asks for no key for a folder", async () => {
		place = { provider: "dir", path: "/Volumes/Backup/splates" };

		expect((await steps())["replica-creds"]).toBeUndefined();
	});

	it("says when the replica caught up and that nothing waits", async () => {
		place = BUCKET;
		status = CAUGHT_UP;

		const { replica } = await steps();

		expect(replica).toMatchObject({ status: "done", warning: null });
		expect(replica?.detail).toMatch(
			/^`s3:\/\/records\/splates`: caught up .+ ago; nothing waits\.$/,
		);
	});

	it("says how many changes wait and since when", async () => {
		place = BUCKET;
		status = {
			...CAUGHT_UP,
			pending: 3,
			behindSince: Date.now() - 30_000,
		};

		expect((await steps()).replica?.detail).toContain(
			"3 changes wait, the oldest from",
		);
	});

	it("says it has not started before the server runs it", async () => {
		place = BUCKET;

		const { replica } = await steps();

		expect(replica).toMatchObject({ status: "ready" });
		expect(replica?.detail).toContain("has not started");
	});

	it("points to the Creds page while it fails for want of the key", async () => {
		place = BUCKET;
		status = {
			...CAUGHT_UP,
			caughtUpAt: null,
			error:
				"no REPLICA_ACCESS_KEY and REPLICA_SECRET_KEY yet: fill them on the Creds page",
		};

		const { replica } = await steps();

		expect(replica?.status).toBe("ready");
		expect(replica?.detail).toContain("never caught up yet");
		expect(replica?.warning).toContain("[Creds page](#creds)");
	});

	it("says why it fails when the bucket is unreachable or another server's", async () => {
		place = BUCKET;
		status = { ...CAUGHT_UP, error: "bucket unreachable" };
		expect((await steps()).replica?.warning).toBe(
			"The last batch failed: bucket unreachable. It is tried again on its own, waiting up to five minutes.",
		);

		status = {
			...CAUGHT_UP,
			error:
				"s3://records/splates holds the records of another server, last caught up on box: restore from it, or give this project's replica its own prefix",
		};
		expect((await steps()).replica?.warning).toStartWith(
			"It refuses to write: s3://records/splates holds the records of another server",
		);
	});
});
