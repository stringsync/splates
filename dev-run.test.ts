import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Conversations } from "./conversations";
import { DevRun } from "./dev-run";
import { AGENT, FakeAgent } from "./fake-agent";
import { Testing } from "./testing";

describe("DevRun", () => {
	let deps: Testing;
	let conversations: Conversations;

	beforeEach(async () => {
		deps = await Testing.open();
		conversations = new Conversations(
			`${deps.arborDir}/conversations`,
			[AGENT],
			{ launch: new FakeAgent().launch },
		);
	});

	afterEach(async () => {
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	const starting = () =>
		DevRun.start({
			journal: deps.journal,
			conversations,
			fs: deps.fs,
			arborDir: deps.arborDir,
		});

	const logged = async () =>
		(await deps.journal.tail(10)).map((event) => event.action);

	it("logs a start, then a stop with why and who was running", async () => {
		const running = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		const run = await starting();
		await run.stop("update");

		expect(await deps.journal.tail(10)).toMatchObject([
			{ action: "dev start", conversations: [] },
			{ action: "dev stop", why: "update", conversations: [running.id] },
		]);
	});

	it("starts with those the run before had running, and logs no stop it already logged", async () => {
		const running = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		await (await starting()).stop("restart");

		await starting();

		expect(await logged()).toEqual(["dev start", "dev stop", "dev start"]);
		expect(await deps.journal.tail(1)).toMatchObject([
			{ conversations: [running.id] },
		]);
	});

	it("logs the stop a crashed run never did", async () => {
		const running = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		await starting();

		await starting();

		expect(await deps.journal.tail(10)).toMatchObject([
			{ action: "dev start" },
			{ action: "dev stop", why: "lost", conversations: [running.id] },
			{ action: "dev start", conversations: [running.id] },
		]);
	});
});
