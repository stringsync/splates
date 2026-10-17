import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { type ArtifactLimits, Artifacts } from "./artifacts";
import type { Conversation } from "./conversation";
import { until } from "./conversation-testing";
import { Conversations } from "./conversations";
import type { Exit } from "./exit";
import { AGENT, FakeAgent } from "./fake-agent";

const DIR = "/repo/.git/arbor/conversations";

describe("Conversation artifacts", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	const open = (artifacts: ArtifactLimits) =>
		new Conversations(DIR, [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			root: "/repo",
			artifacts,
		});

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-16T10:00:00Z"));
		agent = new FakeAgent();
		conversations = open({ file: 10, conversation: 20, project: 30 });
	});

	afterEach(() => conversations.disposeAsync());

	const started = async (within = conversations) => {
		const conversation = await within.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	const file = (name: string, text: string, mimeType = "text/html") => ({
		name,
		mimeType,
		bytes: new TextEncoder().encode(text),
	});

	const refused = async (work: Promise<unknown>): Promise<Exit> => {
		const error = await work.then(
			() => null,
			(cause: unknown) => cause,
		);
		expect(error).not.toBeNull();
		return error as Exit;
	};

	it("keeps each add of a name as its next version", async () => {
		const conversation = await started();

		await conversation.artifacts.add(file("report.html", "one"));
		clock.advance(Duration.secs(1));
		const second = await conversation.artifacts.add(
			file("report.html", "two!"),
		);
		await conversation.artifacts.add(file("shot.png", "png", "image/png"));

		expect(second.version).toBe(2);
		const [report, shot] = conversation.state.artifacts;
		expect(report?.current).toBe(2);
		expect(
			report?.versions.map(({ version, bytes, addedAt, gone }) => ({
				version,
				bytes,
				addedAt,
				gone,
			})),
		).toEqual([
			{ version: 1, bytes: 3, addedAt: "2026-10-16T10:00:00.000Z", gone: null },
			{ version: 2, bytes: 4, addedAt: "2026-10-16T10:00:01.000Z", gone: null },
		]);
		expect(shot?.name).toBe("shot.png");

		const current = await conversation.artifacts.read("report.html");
		expect(new TextDecoder().decode(current?.bytes)).toBe("two!");
		expect(current?.mimeType).toBe("text/html");
		const first = await conversation.artifacts.read("report.html", 1);
		expect(new TextDecoder().decode(first?.bytes)).toBe("one");
		expect(await conversation.artifacts.read("report.html", 3)).toBeNull();
		expect(await conversation.artifacts.read("missing.html")).toBeNull();
	});

	it("stores each version apart, under the conversation's files", async () => {
		const conversation = await started();

		await conversation.artifacts.add(file("a b.html", "one"));
		await conversation.artifacts.add(file("a-b.html", "two"));

		const stored = await fs.readdir(`${DIR}/${conversation.id}/artifacts`);
		expect(stored).toHaveLength(2);
		expect(new Set(stored).size).toBe(2);
	});

	it("marks a removed one, keeping its versions, and lists it again on its next add", async () => {
		const conversation = await started();
		await conversation.artifacts.add(file("report.html", "one"));

		clock.advance(Duration.secs(1));
		await conversation.artifacts.remove("report.html");

		const [report] = conversation.state.artifacts;
		expect(report?.removedAt).toBe("2026-10-16T10:00:01.000Z");
		expect(await conversation.artifacts.read("report.html")).not.toBeNull();
		expect(
			(await refused(conversation.artifacts.remove("report.html"))).reason,
		).toBe("not_found");
		expect((await refused(conversation.artifacts.remove("nope"))).reason).toBe(
			"not_found",
		);

		await conversation.artifacts.add(file("report.html", "two"));
		expect(conversation.state.artifacts[0]?.removedAt).toBeNull();
		expect(conversation.state.artifacts[0]?.current).toBe(2);
	});

	it("deletes a version's bytes, keeping its record and saying why", async () => {
		const conversation = await started();
		await conversation.artifacts.add(file("report.html", "one"));
		await conversation.artifacts.add(file("report.html", "two"));

		clock.advance(Duration.secs(1));
		await conversation.artifacts.delete("report.html", 1, "deleted");

		const [report] = conversation.state.artifacts;
		expect(report?.versions[0]?.gone).toEqual({
			at: "2026-10-16T10:00:01.000Z",
			why: "deleted",
		});
		expect(report?.versions[0]?.bytes).toBe(3);
		expect(await conversation.artifacts.read("report.html", 1)).toBeNull();
		expect(
			await fs.readdir(`${DIR}/${conversation.id}/artifacts`),
		).toHaveLength(1);
		// Its bytes gone, it no longer counts toward the conversation's limit.
		await conversation.artifacts.add(file("big.html", "x".repeat(10)));
		expect(
			(
				await refused(
					conversation.artifacts.delete("report.html", 9, "deleted"),
				)
			).reason,
		).toBe("not_found");
	});

	it("counts files attached to the conversation toward its capacity", async () => {
		const conversation = await started();
		await fs.mkdir(`${DIR}/${conversation.id}/attached/login`);
		await fs.writeBytes(
			`${DIR}/${conversation.id}/attached/login/shot.png`,
			new Uint8Array(15),
		);

		const exit = await refused(
			conversation.artifacts.add(file("report.html", "x".repeat(6))),
		);

		expect(exit.reason).toBe("too_large");
		await conversation.artifacts.add(file("report.html", "x".repeat(5)));
	});

	it("refuses a file past its limit, changing nothing", async () => {
		const conversation = await started();

		const exit = await refused(
			conversation.artifacts.add(file("big.html", "x".repeat(11))),
		);

		expect(exit.reason).toBe("too_large");
		expect(conversation.state.artifacts).toEqual([]);
		expect(await fs.exists(`${DIR}/${conversation.id}/artifacts`)).toBe(false);
	});

	it("refuses an add that takes the conversation past its limit, counting older versions", async () => {
		const conversation = await started();
		await conversation.artifacts.add(file("report.html", "x".repeat(10)));
		await conversation.artifacts.add(file("report.html", "x".repeat(10)));

		const exit = await refused(
			conversation.artifacts.add(file("report.html", "x")),
		);

		expect(exit.reason).toBe("too_large");
		expect(exit.data).toMatchObject({ bytes: 21, capacity: 20 });
		expect(conversation.state.artifacts[0]?.versions).toHaveLength(2);
	});

	/** Each version's number and why its bytes went, by artifact name. */
	const goneOf = (conversation: Conversation) =>
		Object.fromEntries(
			conversation.state.artifacts.map((each) => [
				each.name,
				each.versions.map((version) => version.gone?.why ?? null),
			]),
		);

	it("evicts removed and superseded versions of any conversation first, oldest first", async () => {
		const one = await started();
		const two = await started();
		await one.artifacts.add(file("a.html", "x".repeat(5)));
		clock.advance(Duration.secs(1));
		await two.artifacts.add(file("b.html", "x".repeat(5)));
		clock.advance(Duration.secs(1));
		await one.artifacts.add(file("a.html", "x".repeat(5)));
		clock.advance(Duration.secs(1));
		await two.artifacts.add(file("b.html", "x".repeat(5)));
		await two.artifacts.add(file("c.html", "x".repeat(10)));

		await one.artifacts.add(file("d.html", "x".repeat(6)));

		expect(goneOf(one)).toEqual({
			"a.html": ["evicted", null],
			"d.html": [null],
		});
		expect(goneOf(two)).toEqual({
			"b.html": ["evicted", null],
			"c.html": [null],
		});
		expect(two.state.artifacts[0]?.versions[0]?.gone?.at).toBe(
			"2026-10-16T10:00:03.000Z",
		);
	});

	it("evicts what archived conversations show before what live ones do", async () => {
		const live = await started();
		const archived = await started();
		const adding = await started();
		await live.artifacts.add(file("old.html", "x".repeat(10)));
		clock.advance(Duration.secs(1));
		await archived.artifacts.add(file("shown.html", "x".repeat(10)));
		await archived.archive();
		clock.advance(Duration.secs(1));
		await adding.artifacts.add(file("new.html", "x".repeat(10)));

		await adding.artifacts.add(file("next.html", "x".repeat(10)));
		expect(goneOf(archived)).toEqual({ "shown.html": ["evicted"] });
		expect(goneOf(live)).toEqual({ "old.html": [null] });

		// Then the oldest a live conversation shows, the adding one's own too.
		await live.artifacts.add(file("last.html", "x"));
		expect(goneOf(live)).toEqual({
			"old.html": ["evicted"],
			"last.html": [null],
		});
		expect(goneOf(adding)).toEqual({ "new.html": [null], "next.html": [null] });
	});

	it("counts attached files toward the project without evicting them, refusing what cannot fit", async () => {
		const one = await started();
		const two = await started();
		await fs.mkdir(`${DIR}/${one.id}/attached/login`);
		await fs.writeBytes(
			`${DIR}/${one.id}/attached/login/shot.png`,
			new Uint8Array(25),
		);
		await two.artifacts.add(file("a.html", "x".repeat(5)));

		const exit = await refused(
			two.artifacts.add(file("b.html", "x".repeat(10))),
		);
		expect(exit.reason).toBe("too_large");
		expect(exit.data).toMatchObject({ bytes: 40, capacity: 30 });
		expect(goneOf(two)).toEqual({ "a.html": [null] });

		await two.artifacts.add(file("b.html", "x".repeat(5)));
		expect(goneOf(two)).toEqual({ "a.html": ["evicted"], "b.html": [null] });
		expect(await fs.exists(`${DIR}/${one.id}/attached/login/shot.png`)).toBe(
			true,
		);
	});

	it("refuses an add past the project's limit from a store with no room, counting every conversation", async () => {
		const one = await started();
		const two = await started();
		await one.artifacts.add(file("a.html", "x".repeat(10)));
		await one.artifacts.add(file("b.html", "x".repeat(10)));
		await two.artifacts.add(file("c.html", "x".repeat(10)));
		const held = [...two.state.artifacts];
		const roomless = new Artifacts(`${DIR}/${two.id}.jsonl`, {
			fs,
			now: () => "2026-10-16T10:00:00.000Z",
			limits: { file: 10, conversation: 20, project: 30 },
			held: () => held,
			record: async () => {},
		});

		const exit = await refused(roomless.add(file("d.html", "x")));

		expect(exit.reason).toBe("too_large");
		expect(exit.data).toMatchObject({ bytes: 31, capacity: 30 });
		expect(goneOf(one)).toEqual({ "a.html": [null], "b.html": [null] });
	});

	it("deletes removed and superseded versions as it is archived, keeping what its panel shows", async () => {
		const conversation = await started();
		await conversation.artifacts.add(file("report.html", "one"));
		await conversation.artifacts.add(file("report.html", "two"));
		await conversation.artifacts.add(file("shot.png", "png", "image/png"));
		await conversation.artifacts.remove("shot.png");

		clock.advance(Duration.secs(1));
		await conversation.archive();

		expect(goneOf(conversation)).toEqual({
			"report.html": ["archived", null],
			"shot.png": ["archived"],
		});
		expect(conversation.state.artifacts[1]?.versions[0]?.gone?.at).toBe(
			"2026-10-16T10:00:01.000Z",
		);
		expect(
			await fs.readdir(`${DIR}/${conversation.id}/artifacts`),
		).toHaveLength(1);
		const current = await conversation.artifacts.read("report.html");
		expect(new TextDecoder().decode(current?.bytes)).toBe("two");
	});

	it("tidies a conversation archived before archiving cleaned up, as it is read back", async () => {
		const conversation = await started();
		await conversation.artifacts.add(file("report.html", "one"));
		await conversation.artifacts.add(file("report.html", "two"));
		await conversation.stop();
		// Archived as an older arbor did, its artifacts left as they were.
		await fs.append(
			`${DIR}/${conversation.id}.jsonl`,
			`${JSON.stringify({ kind: "archive", archived: true, at: "2026-10-16T09:00:00.000Z" })}\n`,
		);

		const reread = open({ file: 10, conversation: 20, project: 30 });
		const read = await reread.find(conversation.id);

		expect(goneOf(read)).toEqual({ "report.html": ["archived", null] });
		await reread.disposeAsync();
	});

	it("gives two adds of one name at once a version each", async () => {
		const conversation = await started();

		await Promise.all([
			conversation.artifacts.add(file("report.html", "one")),
			conversation.artifacts.add(file("report.html", "two")),
		]);

		expect(
			conversation.state.artifacts[0]?.versions.map((each) => each.version),
		).toEqual([1, 2]);
	});

	it("reads its log back into the same artifacts", async () => {
		const conversation = await started();
		await conversation.artifacts.add(file("report.html", "one"));
		await conversation.artifacts.add(file("report.html", "two"));
		await conversation.artifacts.add(file("shot.png", "png", "image/png"));
		await conversation.artifacts.remove("shot.png");
		await conversation.artifacts.delete("report.html", 1, "evicted");
		await conversation.stop();

		const reread = open({ file: 10, conversation: 20, project: 30 });
		const read = await reread.find(conversation.id);

		expect(read.state.artifacts).toEqual(conversation.state.artifacts);
		const current = await read.artifacts.read("report.html");
		expect(new TextDecoder().decode(current?.bytes)).toBe("two");
		await reread.disposeAsync();
	});

	it("deletes its artifacts with the conversation", async () => {
		const conversation = await started();
		await conversation.artifacts.add(file("report.html", "one"));

		await conversation.delete();

		expect(await fs.exists(`${DIR}/${conversation.id}/artifacts`)).toBe(false);
	});
});
