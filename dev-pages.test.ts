import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { dev } from "./dev";
import type { Pages } from "./dev-pages";
import { readUntil, within } from "./dev-testing";
import { Testing } from "./testing";

describe("a rebuilt page", () => {
	let deps: Testing;
	let pages: Pages | null;

	beforeEach(async () => {
		deps = await Testing.open();
		pages = null;
	});

	afterEach(() => deps.disposeAsync());

	it("is served from then on, and every open page is told of it", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			rebuilds: (served) => {
				pages = served;
				return { dispose: () => {} };
			},
		});
		try {
			const events = await fetch(`http://localhost:${server.port}/events`);
			const reader = (events.body ?? new ReadableStream()).getReader();
			await readUntil(reader, ": connected");
			const built = pages as unknown as Pages;

			built.replace({ ...built.assets, script: "console.log('new');" });
			const told = await within(reader, "event: page", 5_000);
			const script = await fetch(`http://localhost:${server.port}/main.js`);
			const shell = await fetch(`http://localhost:${server.port}/`);

			expect({
				told,
				script: await script.text(),
				named: (await shell.text()).includes(`content="${built.version}"`),
			}).toEqual({ told: true, script: "console.log('new');", named: true });
			await reader.cancel();
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);
});
