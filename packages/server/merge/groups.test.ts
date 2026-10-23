import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FsStorage } from "../storage";
import { BatchGroups } from "./groups";

describe("BatchGroups", () => {
	it("groups only confirmed running members and follows dissolution and reforming", async () => {
		const storage = new FsStorage("/project", new FakeFs());
		const records = storage.collection("merge-batch");
		const groups = new BatchGroups(storage);
		const running = ["leader", "beta", "gamma", "declined", "stale"];
		await records.write(
			"invite:beta",
			JSON.stringify({ leader: "leader", onto: "tip" }),
		);
		expect(await groups.active(running)).toEqual([]);
		await records.write(
			"stacked:beta",
			JSON.stringify({ onto: "old-tip", head: "beta" }),
		);
		expect(await groups.active(running)).toEqual([]);
		await records.write(
			"stacked:beta",
			JSON.stringify({ onto: "tip", head: "beta" }),
		);
		await records.write(
			"invite:declined",
			JSON.stringify({ leader: "leader", onto: "tip" }),
		);
		await records.write(
			"stacked:declined",
			JSON.stringify({ onto: "tip", head: null }),
		);
		await records.write(
			"invite:stale",
			JSON.stringify({ leader: "gone", onto: "tip" }),
		);
		await records.write(
			"stacked:stale",
			JSON.stringify({ onto: "tip", head: "stale" }),
		);
		expect(await groups.active(running)).toEqual([["leader", "beta"]]);
		expect(await groups.active(["leader"])).toEqual([]);
		await records.write("result:beta", JSON.stringify({ kind: "dissolved" }));
		expect(await groups.active(running)).toEqual([]);
		await records.remove("result:beta");
		await records.write(
			"invite:beta",
			JSON.stringify({ leader: "gamma", onto: "gamma-tip" }),
		);
		expect(await groups.active(running)).toEqual([]);
		await records.write(
			"stacked:beta",
			JSON.stringify({ onto: "gamma-tip", head: "beta2" }),
		);
		expect(await groups.active(running)).toEqual([["gamma", "beta"]]);
		await records.write(
			"result:beta",
			JSON.stringify({
				kind: "landed",
				head: "beta2",
				batch: ["gamma", "beta"],
			}),
		);
		expect(await groups.active(running)).toEqual([]);
	});
});
