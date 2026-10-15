import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { json, serving } from "./dev-testing";
import { Testing } from "./testing";

/** A `wiz` that answers with the args it was given, as one JSON string. */
const ECHO = `f() { printf '{"args":"%s"}' "$*"; }; f`;

describe("dev budgets", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
		deps.config.wiz = ECHO;
	});

	afterEach(() => deps.disposeAsync());

	it("runs scry budgets through the repo's wiz, answering with what it prints", async () => {
		await serving(deps, async (_snapshot, port) => {
			const answers = await Promise.all([
				fetch(`http://127.0.0.1:${port}/api/budgets`),
				json(port, "/api/budgets/llm", "PUT", { spend: "2m/month" }),
				json(port, "/api/budgets/llm", "PUT", { spend: null }),
				json(port, "/api/budgets/som/raises", "POST", {
					tokens: "2m",
					for: "4h",
				}),
				json(port, "/api/budgets/raises/3", "DELETE"),
			]);

			expect(
				await Promise.all(
					answers.map(async (each) => (await each.json()).args),
				),
			).toEqual([
				"scry budgets --format json",
				"scry budgets set llm 2m/month --format json",
				"scry budgets reset llm --format json",
				"scry budgets raise som 2m --for 4h --format json",
				"scry budgets end 3 --format json",
			]);
		});
	});

	it("hands what the page sends to wiz as args, never to the shell", async () => {
		await serving(deps, async (_snapshot, port) => {
			const answer = await json(port, "/api/budgets/llm", "PUT", {
				spend: "$(echo pwned)",
			});

			expect((await answer.json()).args).toBe(
				"scry budgets set llm $(echo pwned) --format json",
			);
		});
	});

	it("refuses with what wiz said when it fails", async () => {
		deps.config.wiz = `echo "error: expected limits like 5m/day" >&2; exit 1; :`;

		await serving(deps, async (_snapshot, port) => {
			const answer = await json(port, "/api/budgets/llm", "PUT", {
				spend: "5m",
			});

			expect([answer.status, await answer.json()]).toEqual([
				400,
				{ reason: "usage", message: "expected limits like 5m/day" },
			]);
		});
	});

	it("refuses a role that is not som or llm", async () => {
		await serving(deps, async (_snapshot, port) => {
			const answer = await json(port, "/api/budgets/gpt/raises", "POST", {
				tokens: "1m",
			});

			expect(answer.status).toBe(400);
		});
	});
});
