import { describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { answerState, sameOrigin } from "./repo-state";

describe("repo state", () => {
	it("refuses a path outside the project's records", async () => {
		await using env = await Testing.open();

		await expect(
			answerState(env.fs, env.splatesDir, { op: "read", path: "../config" }),
		).rejects.toThrow("outside the project's records");
		await expect(
			answerState(env.fs, env.splatesDir, { op: "read", path: "/etc/hosts" }),
		).rejects.toThrow("outside the project's records");
	});

	it("reads and writes under them", async () => {
		await using env = await Testing.open();

		await answerState(env.fs, env.splatesDir, {
			op: "write",
			path: "tasks/x.json",
			data: "{}",
		});

		expect(
			await answerState(env.fs, env.splatesDir, {
				op: "readdir",
				path: "tasks",
			}),
		).toContain("x.json");
	});

	it("reads one origin however its URL is written", () => {
		const ways = [
			"git@github.com:Owner/repo.git",
			"https://github.com/owner/repo",
			"ssh://git@github.com/owner/repo.git",
			"https://github.com/owner/repo.git/",
		];

		expect(new Set(ways.map(sameOrigin))).toEqual(
			new Set(["github.com/owner/repo"]),
		);
	});
});
