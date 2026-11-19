import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "@splates/server/testing";
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

	it("logs a queued task wait with its subject, and how it gave up", async () => {
		await splates.run(deps, [
			"task",
			"add",
			"Seven",
			"detail",
			"--slug",
			"seven",
		]);
		const [queued] = await env.tasks.all();

		await splates.run(deps, [
			"task",
			"wait",
			String(queued?.id),
			"--timeout-secs",
			"0",
		]);

		const [began, ended] = await env.journal.tail(2);
		expect(began).toMatchObject({
			action: "task wait",
			reason: null,
			number: queued?.id,
			subject: "Seven",
			began: null,
		});
		expect(ended).toMatchObject({
			action: "task wait",
			reason: "timeout",
			number: queued?.id,
			began: began?.id,
		});
	});
});
