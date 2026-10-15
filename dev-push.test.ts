import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakePusher } from "webappwiz/push/testing";
import { Duration } from "webappwiz/time";
import type { ConversationState } from "./conversations";
import { conversation } from "./dev/fixtures";
import type { Pushed } from "./dev/worker";
import type { Served } from "./dev-project";
import { Pushes } from "./dev-push";
import { type Needing, need } from "./needs";
import { Testing } from "./testing";

describe("Pushes", () => {
	let deps: Testing;
	let pusher: FakePusher;
	let rows: Needing[];
	let pushes: Pushes;

	const runs = conversation({ id: "c1", title: "Fix", status: "running" });
	const finished = {
		...runs,
		status: "idle" as const,
		messages: [
			{
				role: "agent" as const,
				at: "2026-10-15T10:00:00.000Z",
				parts: [{ type: "text" as const, text: "Merged it." }],
			},
		],
	} as ConversationState;

	const start = () =>
		Pushes.start({
			fs: deps.fs,
			ps: deps.ps,
			log: deps.log,
			projects: deps.projects,
			served: new Map([
				[
					deps.root,
					Promise.resolve({
						root: deps.root,
						needing: async () => ({ rows, lanes: [] }),
					} as unknown as Served),
				],
			]),
			pusher: () => pusher,
			every: Duration.mins(60),
		});

	beforeEach(async () => {
		deps = await Testing.open();
		await deps.projects.register(deps.root);
		pusher = new FakePusher();
		rows = [row(runs)];
		pushes = await start();
	});

	afterEach(async () => {
		pushes.dispose();
		await deps.disposeAsync();
	});

	it("pushes a conversation that finished its turn to each device, opening its row", async () => {
		await pushes.subscribe(
			subscribing({
				subscription: subscription("https://push.example/a"),
				wants: WANTS,
			}),
		);
		await pushes.look();
		rows = [row(finished)];

		await pushes.look();

		const slug = (await deps.projects.list()).find(
			(each) => each.root === deps.root,
		)?.slug;
		expect(pusher.pushed.map((each) => each.subscription.endpoint)).toEqual([
			"https://push.example/a",
		]);
		expect(JSON.parse(pusher.pushed[0]?.payload ?? "") as Pushed).toEqual({
			title: "Fix finished",
			body: "Merged it.",
			key: "conversation c1",
			url: `?project=${slug}#conversations/c1`,
			inFront: false,
		});
	});

	it("pushes only what a device wants", async () => {
		await pushes.subscribe(
			subscribing({
				subscription: subscription("https://push.example/a"),
				wants: { ...WANTS, finished: false },
			}),
		);
		await pushes.look();
		rows = [row(finished)];

		await pushes.look();

		expect(pusher.pushed).toEqual([]);
	});

	it("forgets a device its push service says is gone", async () => {
		await pushes.subscribe(
			subscribing({
				subscription: subscription("https://push.example/a"),
				wants: WANTS,
			}),
		);
		await pushes.look();
		pusher.gone.add("https://push.example/a");
		rows = [row(finished)];
		await pushes.look();
		pusher.gone.clear();
		rows = [row(runs)];
		await pushes.look();
		rows = [row(finished)];

		await pushes.look();

		expect(pusher.pushed).toEqual([]);
		expect(
			JSON.parse(await deps.fs.read(`${deps.arborHome}/push.json`)).devices,
		).toEqual([]);
	});

	it("keeps its keys and devices across a restart", async () => {
		await pushes.subscribe(
			subscribing({
				subscription: subscription("https://push.example/a"),
				wants: WANTS,
			}),
		);
		const key = await (
			await pushes.key(new Request("http://localhost"))
		).json();
		pushes.dispose();

		pushes = await start();
		await pushes.look();
		rows = [row(finished)];
		await pushes.look();

		expect(
			await (await pushes.key(new Request("http://localhost"))).json(),
		).toEqual(key);
		expect(pusher.pushed).toHaveLength(1);
	});

	it("refuses a body that is not a subscription", async () => {
		await expect(
			pushes.subscribe(subscribing({ subscription: { endpoint: "nope" } })),
		).rejects.toThrow("not a push subscription");
	});
});

const WANTS = {
	waiting: true,
	finished: true,
	quiet: true,
	quietAfter: 10,
	inFront: false,
};

const subscription = (endpoint: string) => ({
	endpoint,
	keys: { p256dh: "BKey", auth: "auth" },
});

const row = (held: ConversationState): Needing => ({
	conversation: held,
	task: null,
	need: need(null, held),
});

const subscribing = (body: unknown) =>
	new Request("http://localhost/api/push/subscription", {
		method: "PUT",
		body: JSON.stringify(body),
	});
