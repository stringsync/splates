import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { until } from "./conversation-testing";
import { ARCHIVED_KEPT, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";

describe("Conversations.prune", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		// The trees the agents run in, which a resume looks for.
		for (const tree of ["/repo", "/repo-arbor/login", "/repo-arbor/signup"]) {
			await fs.mkdir(tree);
		}
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		agent = new FakeAgent();
		conversations = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
			},
		);
	});

	afterEach(() => conversations.disposeAsync());

	const started = async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	const dir = "/repo/.git/arbor/conversations";

	/** Logs conversation `id`, started at `createdAt` and archived at `at` when given. */
	const logged = async (
		id: string,
		createdAt: string,
		archived: { at?: string } | null,
	) => {
		const lines = [
			{
				kind: "start",
				id,
				agent: "fake",
				task: null,
				cwd: "/repo",
				createdAt,
			},
			...(archived === null
				? []
				: [{ kind: "archive", archived: true, ...archived }]),
		];
		await fs.mkdir(dir);
		await fs.write(
			`${dir}/${id}.jsonl`,
			lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
		);
	};

	/** When the `i`th archived one went, a minute apart. */
	const minute = (i: number) =>
		new Date(Date.parse("2026-10-01T00:00:00Z") + i * 60_000).toISOString();

	it("deletes the archived ones past the newest kept as they are read back, by when each was archived", async () => {
		for (let i = 0; i < ARCHIVED_KEPT; i++) {
			await logged(`kept${i}`, minute(0), { at: minute(i + 10) });
		}
		// Started last, but archived before any of the kept ones.
		await logged("archived-first", minute(9), { at: minute(1) });
		// Archived before archiving was timed: as of when it started.
		await logged("untimed", minute(0), {});
		await logged("live", minute(0), null);
		await fs.mkdir(`${dir}/archived-first`);
		await fs.write(`${dir}/archived-first/shot.png`, "png");

		const ids = (await conversations.list()).map((each) => each.id);

		expect(ids).toHaveLength(ARCHIVED_KEPT + 1);
		expect(ids).toContain("live");
		expect(ids).not.toContain("archived-first");
		expect(ids).not.toContain("untimed");
		expect(await fs.exists(`${dir}/archived-first.jsonl`)).toBe(false);
		expect(await fs.exists(`${dir}/archived-first`)).toBe(false);
		expect(await fs.exists(`${dir}/untimed.jsonl`)).toBe(false);
		expect(await fs.exists(`${dir}/kept0.jsonl`)).toBe(true);
	});

	it("deletes the one archived longest ago once one more is archived, and says so", async () => {
		for (let i = 0; i < ARCHIVED_KEPT; i++) {
			await logged(`kept${i}`, minute(0), { at: minute(i) });
		}
		const conversation = await started();
		const removed: string[] = [];
		conversations.events.on("removed", (id) => removed.push(id));

		await conversation.archive();
		await conversations.prune();

		const ids = (await conversations.list()).map((each) => each.id);
		expect(removed).toEqual(["kept0"]);
		expect(ids).toHaveLength(ARCHIVED_KEPT);
		expect(ids).toContain(conversation.id);
		expect(await fs.exists(`${dir}/kept0.jsonl`)).toBe(false);
		await expect(conversations.find("kept0")).rejects.toThrow(
			"no conversation kept0",
		);
	});
});
