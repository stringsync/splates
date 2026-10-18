import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/events";
import { Testing } from "@stringsync/splates-server/testing";
import { Duration, sleep } from "webappwiz/time";
import { splates } from "./splates";

describe("splates's waits in the journal", () => {
	let env: Testing;
	let deps: Parameters<typeof splates.run>[0];

	beforeEach(async () => {
		env = await Testing.open();
		env.ps.cd(env.root);
		deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
			secrets: env.secrets,
		};
	});

	afterEach(() => env.disposeAsync());

	it("logs a cred wait as it begins, then as it ends, naming the first", async () => {
		await splates.run(deps, [
			"creds",
			"request",
			"API_TOKEN",
			"--purpose",
			"To test.",
			"--instructions",
			"Paste it.",
		]);

		const waiting = splates.run(deps, ["creds", "wait", "API_TOKEN"]);
		await sleep(Duration.ms(20));
		await env.creds.save("API_TOKEN", "secret");
		await waiting;

		const [began, ended] = (await env.journal.tail(2)) as Extract<
			Event,
			{ action: "creds wait" }
		>[];
		expect(began).toMatchObject({
			action: "creds wait",
			reason: null,
			name: "API_TOKEN",
			began: null,
		});
		expect(ended).toMatchObject({
			action: "creds wait",
			reason: null,
			name: "API_TOKEN",
			began: began?.id,
		});
		expect(Date.parse(ended?.until ?? "")).toBeGreaterThan(
			Date.now() + Duration.mins(14).ms,
		);
	});

	it("logs a todo wait with the todo's subject, and how it gave up", async () => {
		await splates.run(deps, ["todo", "add", "Seven", "detail"]);
		const [todo] = await env.todos.all();

		await splates.run(deps, [
			"todo",
			"wait",
			String(todo?.id),
			"--timeout-secs",
			"0",
		]);

		const [began, ended] = await env.journal.tail(2);
		expect(began).toMatchObject({
			action: "todo wait",
			reason: null,
			todo: todo?.id,
			subject: "Seven",
			began: null,
		});
		expect(ended).toMatchObject({
			action: "todo wait",
			reason: "timeout",
			todo: todo?.id,
			began: began?.id,
		});
	});
});
