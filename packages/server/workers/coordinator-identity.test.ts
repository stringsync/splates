import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { MemorySecretStore } from "webappwiz/creds";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { CONNECTIONS, type Connection } from "../server/shared";
import { joinCoordinatorKey, joinToken } from "./access";
import { WorkerDaemon } from "./daemon";
import { CoordinatorIdentity, challengeNonce, proofHolds } from "./identity";
import { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import { ServerWorkerSocket } from "./server-socket";
import { WebSocketWorkerSocket } from "./websocket-socket";

setDefaultTimeout(10_000);

const KEY = "the-key";

/** Settles once `done` holds, trying every 20ms for up to five seconds. */
async function until(done: () => boolean): Promise<void> {
	for (let i = 0; i < 250 && !done(); i++) {
		await sleep(Duration.ms(20));
	}
	expect(done()).toBe(true);
}

describe("a coordinator's signing key", () => {
	it("signs a nonce and session only its own public key verifies", () => {
		const coordinator = CoordinatorIdentity.generate();
		const other = CoordinatorIdentity.generate();
		const nonce = challengeNonce();
		const signature = coordinator.prove(nonce, "session");

		expect(proofHolds(coordinator.publicKey, nonce, "session", signature)).toBe(
			true,
		);
		expect(proofHolds(other.publicKey, nonce, "session", signature)).toBe(
			false,
		);
		expect(
			proofHolds(coordinator.publicKey, challengeNonce(), "session", signature),
		).toBe(false);
		expect(proofHolds(coordinator.publicKey, nonce, "other", signature)).toBe(
			false,
		);
		expect(proofHolds("not a key", nonce, "session", signature)).toBe(false);
	});

	it("is made once and kept in the store", async () => {
		const store = new MemorySecretStore("creds");

		const first = await CoordinatorIdentity.open(store);
		const again = await CoordinatorIdentity.open(store);

		expect(again.publicKey).toBe(first.publicKey);
		expect(proofHolds(first.publicKey, "n", "s", again.prove("n", "s"))).toBe(
			true,
		);
	});

	it("rides in a join token beside the Access service token", () => {
		const identity = CoordinatorIdentity.generate();
		const access = { clientId: "id.access", clientSecret: "secret" };

		expect(
			joinCoordinatorKey(joinToken("splj_a", access, identity.publicKey)),
		).toBe(identity.publicKey);
		expect(
			joinCoordinatorKey(joinToken("splj_a", null, identity.publicKey)),
		).toBe(identity.publicKey);
		expect(joinCoordinatorKey(joinToken("splj_a", access))).toBeNull();
		expect(joinCoordinatorKey("splj_a")).toBeNull();
	});
});

describe("a worker checking its coordinator", () => {
	const disposers: (() => void | Promise<void>)[] = [];
	afterEach(async () => {
		for (const dispose of disposers.splice(0)) {
			await dispose();
		}
	});

	/** A coordinator on `identity` that takes `KEY` as `box`'s, and the keys it was shown. */
	function coordinator(identity: CoordinatorIdentity, header: boolean) {
		const shown: string[] = [];
		const registry = new WorkerRegistry(new MemoryLogger(), {
			helloWithin: Duration.ms(300),
			identity,
			verify: (id, key) => {
				shown.push(key);
				return id === "box" && key === KEY;
			},
		});
		const server = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request, bun) =>
				bun.upgrade(request, {
					data: new ServerWorkerSocket(
						registry,
						header && request.headers.has("authorization") ? "box" : null,
					),
				})
					? undefined
					: new Response("a WebSocket, please", { status: 400 }),
			websocket: CONNECTIONS,
		});
		disposers.push(async () => {
			registry.dispose();
			await server.stop(true);
		});
		const joined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		return { registry, port: server.port as number, shown, joined };
	}

	function worker(
		port: number,
		verify: { coordinator: string; key: string } | undefined,
	) {
		const log = new MemoryLogger();
		const url = `ws://127.0.0.1:${port}/api/workers/socket`;
		const headers: Record<string, string> =
			verify === undefined ? { authorization: `Bearer box:${KEY}` } : {};
		const daemon = new WorkerDaemon(
			{
				where: url,
				dial: () =>
					WebSocketWorkerSocket.connect(url, headers, Duration.ms(300)),
				...(verify === undefined ? {} : { verify }),
			},
			{
				id: "box",
				slots: 1,
				proofWithin: Duration.ms(300),
				ps: new NodePs(),
				fs: new NodeFs(),
				log,
				backoff: { min: Duration.ms(20), max: Duration.ms(50) },
			},
		);
		void daemon.run();
		disposers.push(() => daemon.disposeAsync());
		return log;
	}

	it("joins a coordinator that signs its nonce, sending its key after", async () => {
		const identity = CoordinatorIdentity.generate();
		const ours = coordinator(identity, true);
		worker(ours.port, { coordinator: identity.publicKey, key: KEY });

		const joined = await ours.joined;

		expect(joined.verified).toBe(true);
		expect(ours.shown).toEqual([KEY]);
	});

	it("refuses an impostor of the right host that cannot sign, giving it no key", async () => {
		const real = CoordinatorIdentity.generate();
		const impostor = coordinator(CoordinatorIdentity.generate(), true);
		const log = worker(impostor.port, {
			coordinator: real.publicKey,
			key: KEY,
		});

		await until(() =>
			JSON.stringify(log.entries).includes("refusing the coordinator"),
		);
		await sleep(Duration.ms(200));

		expect(impostor.shown).toEqual([]);
		expect(impostor.registry.workers).toEqual([]);
		expect(JSON.stringify(log.entries)).not.toContain(KEY);
	});

	it("refuses an impostor that never answers the challenge", async () => {
		const real = CoordinatorIdentity.generate();
		const silent = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request, bun) =>
				bun.upgrade(request, { data: {} as Connection })
					? undefined
					: new Response("no"),
			websocket: {
				message() {},
				open() {},
				close() {},
			},
		});
		disposers.push(() => silent.stop(true));
		const log = worker(silent.port as number, {
			coordinator: real.publicKey,
			key: KEY,
		});

		await until(() =>
			JSON.stringify(log.entries).includes("refusing the coordinator"),
		);
	}, 20_000);

	it("hangs up on a worker that says hello without the key it joined with", async () => {
		const identity = CoordinatorIdentity.generate();
		const ours = coordinator(identity, true);
		worker(ours.port, { coordinator: identity.publicKey, key: "wrong" });

		await until(() => ours.shown.includes("wrong"));
		await sleep(Duration.ms(100));

		expect(ours.registry.workers).toEqual([]);
	});

	it("still takes a worker that joined before tokens carried the key, listing it unverified", async () => {
		const ours = coordinator(CoordinatorIdentity.generate(), true);
		worker(ours.port, undefined);

		const joined = await ours.joined;

		expect(joined.verified).toBe(false);
	});
});
