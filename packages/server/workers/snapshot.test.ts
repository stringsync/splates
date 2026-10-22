import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { type Document, FsStorage } from "../storage";
import {
	forgetSnapshot,
	type KeptSnapshots,
	keptSnapshot,
	SNAPSHOT_FRESH,
	Snapshots,
	snapshotRecipe,
} from "./snapshot";
import { FakeWorkerProvider } from "./testing";

describe("the worker snapshot", () => {
	let wall: FakeWallClock;
	let provider: FakeWorkerProvider;
	let opts: { document: Document<KeptSnapshots> };
	let opened: (version: string) => Promise<Snapshots>;

	beforeEach(() => {
		wall = new FakeWallClock(0);
		provider = new FakeWorkerProvider(undefined, wall);
		opts = {
			document: new FsStorage("/home", new FakeFs()).document("snapshots.json"),
		};
		opened = (version) => Snapshots.open(provider, { ...opts, version, wall });
	});

	it("installs bun, git, the browser and the version asked for, with no credentials", () => {
		const script = snapshotRecipe("linux", "1.2.3")?.script ?? "";

		expect(script).toContain("git");
		expect(script).toContain("bun.sh/install");
		expect(script).toContain("@stringsync/splates@1.2.3");
		expect(script).toContain("chromium-headless-shell");
		expect(script).not.toMatch(/token|key|secret/i);
	});

	it("has no recipe for a platform it cannot build yet", () => {
		expect(snapshotRecipe("macos", "1.2.3")).toBeNull();
	});

	it("builds one when there is none, then keeps it across restarts", async () => {
		const first = await (await opened("1.0.0")).current("linux");
		const again = await (await opened("1.0.0")).current("linux");

		expect(again).toEqual(first);
		expect(provider.getCalls()).toEqual(["snapshot linux 1.0.0"]);
	});

	it("answers none at first and builds one behind, then answers it", async () => {
		const snapshots = await opened("1.0.0");

		expect(await snapshots.ready("linux")).toBeNull();
		await snapshots.refresh("linux");
		expect(await snapshots.ready("linux")).toMatchObject({ version: "1.0.0" });
		expect(provider.getCalls()).toEqual(["snapshot linux 1.0.0"]);
		expect(snapshots.recipe("linux")).toContain("@stringsync/splates@1.0.0");
	});

	it("boots from one another process built since it opened, as setup does", async () => {
		const server = await opened("1.0.0");
		const built = await (await opened("1.0.0")).current("linux");

		expect(await server.current("linux")).toEqual(built);
		expect(provider.getCalls()).toEqual(["snapshot linux 1.0.0"]);
	});

	it("forgets the one kept, so the next worker builds again", async () => {
		const built = await (await opened("1.0.0")).current("linux");

		expect(await forgetSnapshot("linux", opts)).toEqual(built);
		expect(await forgetSnapshot("linux", opts)).toBeNull();
		expect(await keptSnapshot("linux", opts)).toBeNull();
	});

	it("builds again once setup's undo has forgotten the one it boots from", async () => {
		const snapshots = await opened("1.0.0");
		await snapshots.current("linux");

		await forgetSnapshot("linux", opts);
		await snapshots.current("linux");

		expect(provider.getCalls()).toEqual([
			"snapshot linux 1.0.0",
			"snapshot linux 1.0.0",
		]);
	});

	it("builds again for a new version, or once it is a week old", async () => {
		await (await opened("1.0.0")).current("linux");
		const upgraded = await opened("1.1.0");
		await upgraded.current("linux");
		wall.set(SNAPSHOT_FRESH.ms - Duration.mins(1).ms);
		await upgraded.current("linux");
		wall.set(SNAPSHOT_FRESH.ms);
		await upgraded.current("linux");

		expect(provider.getCalls()).toEqual([
			"snapshot linux 1.0.0",
			"snapshot linux 1.1.0",
			"snapshot linux 1.1.0",
		]);
	});

	it("shares one build between workers asking at once", async () => {
		const snapshots = await opened("1.0.0");

		await Promise.all([snapshots.current("linux"), snapshots.current("linux")]);

		expect(provider.getCalls()).toEqual(["snapshot linux 1.0.0"]);
	});
});
