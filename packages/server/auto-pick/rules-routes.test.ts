import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";

import { dev } from "../server";
import { json } from "../server/testing";
import { Testing } from "../testing";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";
import type { AutoPickRulesView } from "./rules-routes";

const MINE: AutoPickRules = {
	format: 2,
	threshold: 0.6,
	rules: [
		{
			kind: "open",
			depth: "*",
			picks: [{ agent: "fake", model: "small" }],
		},
		{ kind: "*", depth: "*", picks: [{ agent: "fake", effort: "high" }] },
	],
};

describe("dev's Auto pick rules", () => {
	let deps: Testing;
	let path: string;

	beforeEach(async () => {
		deps = await Testing.open();
		path = `${deps.splatesHome}/auto-pick.json`;
		await deps.fs.write(
			`${deps.splatesHome}/agents.json`,
			JSON.stringify({ agents: [ROSTERED] }),
		);
	});

	afterEach(() => deps.disposeAsync());

	it("reads the defaults with no file, and the roster's agents a pick can name", async () => {
		const server = await dev(deps, { ports: OpenPortProvider.any() });
		try {
			const view = (await (
				await fetch(`http://127.0.0.1:${server.port}/api/auto-pick/rules`)
			).json()) as AutoPickRulesView;

			expect(view).toEqual({
				rules: DEFAULT_RULES,
				problem: null,
				agents: [
					{
						id: "fake",
						name: ROSTERED.name,
						models: [
							{ id: "big", name: "Big" },
							{ id: "small", name: "Small" },
						],
						efforts: null,
					},
				],
			});
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);

	it("saves rules that check out, and resets them to the defaults", async () => {
		const server = await dev(deps, { ports: OpenPortProvider.any() });
		try {
			const saved = await json(server.port, "/api/auto-pick/rules", "PUT", {
				rules: MINE,
			});
			expect(saved.status).toBe(200);
			expect(((await saved.json()) as AutoPickRulesView).rules).toEqual(MINE);
			expect(JSON.parse(await deps.fs.read(path))).toEqual(MINE);

			const reset = await json(
				server.port,
				"/api/auto-pick/rules/reset",
				"POST",
			);
			expect(((await reset.json()) as AutoPickRulesView).rules).toEqual(
				DEFAULT_RULES,
			);
			expect(JSON.parse(await deps.fs.read(path))).toEqual(DEFAULT_RULES);
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);

	it("refuses rules whose last is not * *, leaving the file as it was", async () => {
		await deps.fs.write(path, JSON.stringify(MINE));
		const server = await dev(deps, { ports: OpenPortProvider.any() });
		try {
			const refused = await json(server.port, "/api/auto-pick/rules", "PUT", {
				rules: { ...MINE, rules: MINE.rules.slice(0, 1) },
			});

			expect(refused.status).toBe(400);
			expect(await refused.json()).toEqual({
				reason: "usage",
				message:
					"not Auto pick rules: rules.0: the last rule must be kind * and depth * with any certainty, so every task maps to a pick",
			});
			expect(JSON.parse(await deps.fs.read(path))).toEqual(MINE);
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);

	it("reads a broken file as the defaults, saying why", async () => {
		await deps.fs.write(path, "{");
		const server = await dev(deps, { ports: OpenPortProvider.any() });
		try {
			const view = (await (
				await fetch(`http://127.0.0.1:${server.port}/api/auto-pick/rules`)
			).json()) as AutoPickRulesView;

			expect(view.rules).toEqual(DEFAULT_RULES);
			expect(view.problem).toBe(`${path} is not JSON: fix or delete it`);
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);
});

const ROSTERED = {
	id: "fake",
	name: "Fake",
	argv: ["fake-acp"],
	models: [
		{ id: "big", name: "Big", strengths: "hard problems", cost: "high" },
		{ id: "small", name: "Small", strengths: "quick edits", cost: "low" },
	],
};
