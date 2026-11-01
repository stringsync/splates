import { beforeEach, describe, expect, it } from "bun:test";
import { MergeLine, type Stack } from "./line";

const silent = { info: () => {}, error: () => {} };
const stays = async () => {};

describe("MergeLine", () => {
	let line: MergeLine;
	beforeEach(() => {
		line = new MergeLine(silent);
	});

	it("stacks the merges waiting on the base, oldest first, each on the one before", async () => {
		const asked: string[] = [];
		const stack =
			(task: string): Stack =>
			async (onto) => {
				asked.push(`${task}@${onto}`);
				return `${task}-head`;
			};
		using _beta = line.join("beta", "main", stack("beta"), stays);
		using _gamma = line.join("gamma", "main", stack("gamma"), stays);
		using _other = line.join("other", "next", stack("other"), stays);

		const members = await line.form("alpha", "main", "tip");

		expect(asked).toEqual(["beta@tip", "gamma@beta-head"]);
		expect(members).toEqual([
			{ task: "beta", onto: "tip", head: "beta-head" },
			{ task: "gamma", onto: "beta-head", head: "gamma-head" },
		]);
	});

	it("stacks no more than the cap, its leader counted", async () => {
		line = new MergeLine(silent, 2);
		using _beta = line.join("beta", "main", async () => "b", stays);
		using _gamma = line.join("gamma", "main", async () => "g", stays);

		const members = await line.form("alpha", "main", "tip");

		expect(members.map((each) => each.task)).toEqual(["beta"]);
	});

	it("leaves a merge that conflicted with the stack out of that leader's batches", async () => {
		let asked = 0;
		using _beta = line.join(
			"beta",
			"main",
			async () => {
				asked++;
				return null;
			},
			stays,
		);

		expect(await line.form("alpha", "main", "tip")).toEqual([]);
		expect(await line.form("alpha", "main", "tip")).toEqual([]);
		expect(asked).toBe(1);
		expect(await line.form("delta", "main", "tip")).toEqual([]);
		expect(asked).toBe(2);
	});

	it("settles a member it tells, and sends one it dissolves back to waiting", async () => {
		let dissolved = 0;
		using beta = line.join(
			"beta",
			"main",
			async () => "b",
			async () => {
				dissolved++;
			},
		);
		const members = await line.form("alpha", "main", "tip");
		expect(beta.stacked()).toBe(true);

		await line.dissolve(members);
		expect(dissolved).toBe(1);
		expect(beta.stacked()).toBe(false);

		const again = await line.form("alpha", "main", "tip");
		line.tell(
			{ task: "beta", onto: "tip", head: "b" },
			{ kind: "landed", head: "b", batch: ["alpha", "beta"] },
		);
		expect(again).toHaveLength(1);
		expect(await beta.settled).toEqual({
			kind: "landed",
			head: "b",
			batch: ["alpha", "beta"],
		});
	});

	it("names each batch gating, leader first, until it is done", () => {
		const gating = line.gating("alpha", [
			{ task: "beta", onto: "tip", head: "b" },
		]);
		using _alone = line.gating("delta", []);

		expect(line.groups()).toEqual([["alpha", "beta"]]);
		gating[Symbol.dispose]();
		expect(line.groups()).toEqual([]);
	});

	it("takes a merge out of the line once its offer is disposed of", async () => {
		const beta = line.join("beta", "main", async () => "b", stays);
		expect(line.has("beta")).toBe(true);

		beta[Symbol.dispose]();

		expect(line.has("beta")).toBe(false);
		expect(await line.form("alpha", "main", "tip")).toEqual([]);
	});
});
