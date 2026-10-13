import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import {
	ARCHIVED_KEPT,
	type Conversation,
	type ConversationState,
	Conversations,
	fold,
	launch,
	type Status,
	unused,
} from "./conversations";
import {
	AGENT,
	backgroundEnded,
	backgroundStarted,
	backgroundWrites,
	FakeAgent,
	heard,
	say,
} from "./fake-agent";
import { Offered } from "./offered";
import { CHECKPOINT, RESUME } from "./prompts";
import { unknownLine } from "./systems";
import { Testing } from "./testing";
import { Watch } from "./watch";

/** What each session is opened with, so Claude asks the arbor way. */
const ASK_IN_ARBOR = {
	claudeCode: { options: { disallowedTools: ["AskUserQuestion"] } },
};

describe("Conversations", () => {
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

	/** Settles once `conversation` has `status`; a test that never sees it times out. */
	const until = (conversation: Conversation, status: Status) =>
		new Promise<void>((resolve) => {
			const check = () => {
				if (conversation.state.status === status) {
					off();
					resolve();
				}
			};
			const off = conversation.events.on("changed", check);
			check();
		});

	const started = async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	it("starts the agent in the task's tree and offers its settings", async () => {
		const conversation = await started();

		expect(agent.launched).toEqual([
			{
				argv: ["fake-acp"],
				cwd: "/repo-arbor/login",
				env: { ARBOR_CONVERSATION: "0" },
			},
		]);
		expect(conversation.state).toMatchObject({
			agent: "fake",
			task: "login",
			settings: [
				{ id: "mode", category: "mode", current: "ask" },
				{
					id: "model",
					name: "Model",
					category: "model",
					current: "big",
					options: [
						{ value: "big", name: "Big", description: null },
						{ value: "small", name: "Small", description: "Fast" },
					],
				},
				{
					id: "fast",
					name: "Fast mode",
					type: "boolean",
					current: "off",
					options: [
						{ value: "on", name: "On", description: null },
						{ value: "off", name: "Off", description: null },
					],
				},
			],
		});
	});

	it("turns Claude's AskUserQuestion off, so it asks under ## Blocked instead", async () => {
		await started();

		expect(agent.opened).toEqual([ASK_IN_ARBOR]);
	});

	it("sets the settings picked up front once the session is open, skipping what it already is", async () => {
		const conversation = await conversations.start("fake", {
			task: null,
			cwd: "/repo",
			settings: { model: "small", mode: "ask", size: "huge" },
		});
		await until(conversation, "idle");

		expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
		expect(
			conversation.state.settings.map((each) => [each.id, each.current]),
		).toEqual([
			["mode", "ask"],
			["model", "small"],
			["fast", "off"],
		]);
	});

	it("sets an on/off setting as a boolean, picked up front or switched", async () => {
		const conversation = await conversations.start("fake", {
			task: null,
			cwd: "/repo",
			settings: { fast: "on" },
		});
		await until(conversation, "idle");
		await conversation.choose("fast", "off");

		expect(agent.chosen).toEqual([
			{ configId: "fast", value: true },
			{ configId: "fast", value: false },
		]);
		expect(
			conversation.state.settings.find((each) => each.id === "fast")?.current,
		).toBe("off");
	});

	it("remembers what an agent's sessions offer for every project, as last left", async () => {
		const offered = new Offered("/home/.arbor/offered.json", { fs });
		const project = (dir: string) =>
			new Conversations(dir, [AGENT], {
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				offered,
			});
		const shop = project("/shop/.git/arbor/conversations");
		const conversation = await shop.start("fake", { task: null, cwd: "/shop" });
		await until(conversation, "idle");
		await conversation.choose("model", "small");
		await shop.disposeAsync();

		// Another project, and another process, as after a restart.
		const blog = project("/blog/.git/arbor/conversations");
		const later = new Offered(offered.path, { fs });
		expect(await blog.settings()).toEqual(await later.all());
		const settings = (await later.all()).fake ?? [];
		expect(settings.map((each) => [each.id, each.current])).toEqual([
			["mode", "ask"],
			["model", "small"],
			["fast", "off"],
		]);

		// A log read back, older than what was offered since, changes nothing.
		await offered.remember("fake", []);
		await project("/shop/.git/arbor/conversations").list();
		expect((await offered.all()).fake).toEqual([]);
	});

	it("refuses an agent it does not know", async () => {
		await expect(
			conversations.start("nobody", { task: null, cwd: "/repo" }),
		).rejects.toThrow("no agent 'nobody': use one of fake");
	});

	describe("systems mentioned with #", () => {
		let tree: string;

		beforeEach(async () => {
			// Imported from disk, and read through `fs` to tell when it changed.
			tree = await mkdtemp(join(tmpdir(), "arbor-mentions-"));
			const config = `export default { systems: { playback: { aliases: ["player"], globs: ["src/audio/**"] } } };\n`;
			await writeFile(join(tree, "arbor.config.ts"), config);
			await fs.mkdir(tree);
			await fs.write(join(tree, "arbor.config.ts"), config);
		});

		afterEach(() => rm(tree, { recursive: true, force: true }));

		it("tells the agent what each one is made of, and keeps the words as typed in the thread", async () => {
			const conversation = await conversations.start("fake", {
				task: "login",
				cwd: tree,
			});
			await until(conversation, "idle");

			await conversation.prompt("Fix the gap in #player between tracks.");
			await until(conversation, "idle");

			expect(agent.prompts.at(-1)).toEqual([
				{
					type: "text",
					text: "Fix the gap in #player between tracks.\n\n#playback (player): src/audio/**",
				},
			]);
			expect(conversation.state.messages[0]).toMatchObject({
				parts: [
					{ type: "text", text: "Fix the gap in #player between tracks." },
				],
			});
		});

		it("asks the agent to find the code a # naming no system means, and leaves a todo's number alone", async () => {
			const conversation = await conversations.start("fake", {
				task: "login",
				cwd: tree,
			});
			await until(conversation, "idle");

			await conversation.prompt("See #12, #player and #mixer");
			await until(conversation, "idle");

			expect(agent.prompts.at(-1)).toEqual([
				{
					type: "text",
					text: `See #12, #player and #mixer\n\n#playback (player): src/audio/**\n${unknownLine("mixer")}`,
				},
			]);
		});
	});

	it("runs a turn, folding streamed text and tool calls into one message", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Reading ") });
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "cat note.txt",
					status: "in_progress",
				},
			});
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "t1",
					status: "completed",
				},
			});
			await client.sessionUpdate({ sessionId, update: say("it says ") });
			await client.sessionUpdate({ sessionId, update: say("hi.") });
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					title: "Read the note",
				},
			});
			return "end_turn";
		};
		const conversation = await started();

		await conversation.prompt("  what does note.txt say?  ");
		expect(conversation.state.status).toBe("running");
		await until(conversation, "idle");

		expect(conversation.state.title).toBe("Read the note");
		expect(conversation.state.messages).toMatchObject([
			{
				role: "user",
				parts: [{ type: "text", text: "what does note.txt say?" }],
			},
			{
				role: "agent",
				parts: [
					{ type: "text", text: "Reading " },
					{
						type: "tool",
						id: "t1",
						title: "cat note.txt",
						status: "completed",
					},
					{ type: "text", text: "it says hi." },
				],
			},
		]);
	});

	describe("said while the agent works", () => {
		let held: { finish?: (reason: acp.StopReason) => void };
		let said: string[];

		let client: acp.AgentSideConnection | undefined;

		beforeEach(() => {
			held = {};
			said = [];
			agent.turn = (connection, _session, text) => {
				client = connection;
				said.push(text);
				return new Promise((resolve) => (held.finish = resolve));
			};
		});

		/** Runs a turn on "one" and waits until the agent is on it. */
		const working = async () => {
			const conversation = await started();
			await conversation.prompt("one");
			for (let i = 0; i < 100 && held.finish === undefined; i++) {
				await Bun.sleep(1);
			}
			return conversation;
		};

		const finish = async (conversation: Conversation) => {
			const finishing = held.finish;
			held.finish = undefined;
			finishing?.("end_turn");
			await until(conversation, "idle");
		};

		const thread = (conversation: Conversation) =>
			conversation.state.messages.map((each) => [
				each.parts
					.map((part) => (part.type === "text" ? part.text : ""))
					.join(""),
				each.queued ?? false,
			]);

		it("joins the running turn when the agent steers", async () => {
			agent.steering = "injected";
			const conversation = await working();

			await conversation.prompt("two");

			expect(agent.steered).toEqual(["two"]);
			expect(conversation.state.status).toBe("running");
			expect(thread(conversation)).toEqual([
				["one", false],
				["two", false],
			]);
			await finish(conversation);
			expect(said).toEqual(["one"]);
		});

		it("marks a message the agent steered in, after a restart too", async () => {
			agent.steering = "injected";
			const conversation = await working();

			await conversation.prompt("two");
			await finish(conversation);
			await conversation.stop();
			const [read] = await new Conversations(
				"/repo/.git/arbor/conversations",
				[AGENT],
				{ fs, timer, clock, launch: agent.launch },
			).list();

			for (const each of [conversation, read]) {
				expect(
					each?.state.messages
						.filter((message) => message.role === "user")
						.map((message) => message.steered ?? false),
				).toEqual([false, true]);
			}
		});

		it("gives each message said while the agent starts a turn of its own, even when it steers", async () => {
			agent.steering = "injected";
			const conversation = await conversations.start("fake", {
				task: "login",
				cwd: "/repo-arbor/login",
			});

			await Promise.all([
				conversation.prompt("one"),
				conversation.prompt("two"),
			]);

			expect(agent.steered).toEqual([]);
			expect(thread(conversation)).toEqual([
				["one", false],
				["two", true],
			]);
			for (let i = 0; i < 100 && held.finish === undefined; i++) {
				await Bun.sleep(1);
			}
			held.finish?.("end_turn");
			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(1);
			}
			expect(said).toEqual(["one", "two"]);
			await finish(conversation);
		});

		it("waits for the turn to end when the agent cannot steer, then says all that waited as one prompt", async () => {
			const conversation = await working();

			await conversation.prompt("two");
			await conversation.prompt("three");

			expect(thread(conversation)).toEqual([
				["one", false],
				["two", true],
				["three", true],
			]);
			await client?.sessionUpdate({
				sessionId: "s1",
				update: say("Still on one."),
			});
			for (let i = 0; i < 100 && conversation.state.messages.length < 4; i++) {
				await Bun.sleep(1);
			}
			// Below what the agent says meanwhile, since it has yet to hear them.
			expect(thread(conversation)).toEqual([
				["one", false],
				["Still on one.", false],
				["two", true],
				["three", true],
			]);
			held.finish?.("end_turn");
			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(1);
			}
			expect(said).toEqual(["one", "two\n\nthree"]);
			expect(conversation.state.status).toBe("running");
			expect(thread(conversation)).toEqual([
				["one", false],
				["Still on one.", false],
				["two", false],
				["three", false],
			]);
			await finish(conversation);
		});

		it("holds a queued message's images for the turn's end, and hands them back when it is taken back", async () => {
			agent.sees = true;
			const conversation = await working();
			const png = { mimeType: "image/png", data: btoa("png bytes") };

			await conversation.prompt("two", [png]);
			await conversation.prompt("three", [png]);

			expect(conversation.unqueue(1)).toEqual({
				text: "three",
				images: [
					{ name: expect.stringMatching(/\.png$/), mimeType: "image/png" },
				],
			});
			held.finish?.("end_turn");
			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(1);
			}
			expect(agent.prompts.at(-1)).toEqual([
				{ type: "image", mimeType: "image/png", data: png.data },
				{ type: "text", text: "two" },
			]);
			await finish(conversation);
		});

		it("waits for the turn's end when the agent finds no turn to steer", async () => {
			// As when the agent ended its turn, and arbor has yet to hear.
			agent.steering = "promptRequired";
			const conversation = await working();

			await conversation.prompt("two");

			expect(thread(conversation).at(-1)).toEqual(["two", true]);
			held.finish?.("end_turn");
			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(1);
			}
			expect(said).toEqual(["one", "two"]);
			await finish(conversation);
		});

		describe("a turn the agent starts on its own", () => {
			/** What Claude sends as a turn ends, saying where the turn came from. */
			const result = (kind: string): acp.SessionUpdate => ({
				sessionUpdate: "usage_update",
				used: 1,
				size: 10,
				_meta: { "_claude/origin": { kind } },
			});

			/** Ends a turn on "one", then has the agent start one of its own. */
			const unprompted = async () => {
				const conversation = await working();
				await update(result("human"));
				await finish(conversation);
				await client?.sessionUpdate({
					sessionId: "s1",
					update: say("The tests passed."),
				});
				return conversation;
			};

			const update = async (update: acp.SessionUpdate) => {
				await client?.sessionUpdate({ sessionId: "s1", update });
			};

			it("runs until the agent says that turn ended", async () => {
				const conversation = await unprompted();

				expect(conversation.state.status).toBe("running");
				await update({ sessionUpdate: "usage_update", used: 1, size: 10 });
				expect(conversation.state.status).toBe("running");
				await update(result("task-notification"));
				expect(conversation.state.status).toBe("idle");
			});

			it("starts none for an agent that never says a turn ended", async () => {
				const conversation = await working();
				await finish(conversation);

				await update(say("A late word."));

				expect(conversation.state.status).toBe("idle");
			});

			it("starts no turn on a tool call's late word", async () => {
				const conversation = await working();
				await update(result("human"));
				await finish(conversation);

				await update({
					sessionUpdate: "tool_call_update",
					toolCallId: "t1",
					status: "completed",
				});

				expect(conversation.state.status).toBe("idle");
			});

			it("queues what is said meanwhile for its end, when the agent cannot steer", async () => {
				const conversation = await unprompted();

				await conversation.prompt("two");

				expect(thread(conversation).at(-1)).toEqual(["two", true]);
				expect(said).toEqual(["one"]);
				await update(result("task-notification"));
				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(1);
				}
				expect(said).toEqual(["one", "two"]);
				await finish(conversation);
			});

			it("steers what is said meanwhile into it, when the agent can", async () => {
				agent.steering = "injected";
				const conversation = await unprompted();

				await conversation.prompt("two");

				expect(agent.steered).toEqual(["two"]);
				expect(thread(conversation).at(-1)).toEqual(["two", false]);
				await update(result("task-notification"));
				expect(conversation.state.status).toBe("idle");
				expect(said).toEqual(["one"]);
			});
		});

		it("holds what waited when the turn is cancelled, until the next message", async () => {
			const conversation = await working();
			await conversation.prompt("two");

			await conversation.cancel();
			await finish(conversation);

			expect(said).toEqual(["one"]);
			expect(thread(conversation).at(-1)).toEqual(["two", true]);
			await conversation.prompt("three");
			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(1);
			}
			expect(said).toEqual(["one", "two\n\nthree"]);
			await finish(conversation);
		});

		it("marks the turn the person stopped, and reads the mark back from its log", async () => {
			const conversation = await working();

			await conversation.cancel();
			await finish(conversation);

			const [, reply] = conversation.state.messages;
			const stopped = reply?.stopped;
			expect(reply?.role).toBe("agent");
			expect(typeof stopped).toBe("string");
			await conversation.stop();
			const reread = new Conversations(
				"/repo/.git/arbor/conversations",
				[AGENT],
				{ fs, timer, launch: agent.launch },
			);
			const [read] = await reread.list();
			expect(read?.state.messages.at(-1)?.stopped).toBe(stopped);
			await reread.disposeAsync();
		});

		describe("checkpoint", () => {
			it("cancels the turn and says the checkpoint alone, leaving what waited queued", async () => {
				const conversation = await working();
				await conversation.prompt("two");

				const asking = conversation.checkpoint(false);
				for (let i = 0; i < 100 && agent.cancelled === 0; i++) {
					await Bun.sleep(1);
				}
				expect(conversation.state.checkpoint).toBe("asked");
				held.finish?.("cancelled");
				await asking;

				expect(conversation.state.checkpoint).toBe("asked");
				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(1);
				}
				expect(said).toEqual(["one", CHECKPOINT]);
				await finish(conversation);
				expect(conversation.state.checkpoint).toBe("done");
				expect(conversation.state.messages.some((each) => each.stopped)).toBe(
					false,
				);
				expect(thread(conversation)).toEqual([
					["one", false],
					["two", true],
					[CHECKPOINT, false],
				]);
			});

			it("forgets a finished checkpoint once the person says more", async () => {
				const conversation = await started();
				await conversation.checkpoint(false);
				for (let i = 0; i < 100 && held.finish === undefined; i++) {
					await Bun.sleep(1);
				}
				await finish(conversation);
				expect(conversation.state.checkpoint).toBe("done");

				await conversation.prompt("carry on");

				expect(conversation.state.checkpoint).toBeNull();
				for (let i = 0; i < 100 && held.finish === undefined; i++) {
					await Bun.sleep(1);
				}
				await finish(conversation);
			});

			it("forgets a checkpoint dismissed before the agent answers", async () => {
				const conversation = await started();
				await conversation.checkpoint(false);

				conversation.dismissCheckpoint();
				timer.fireTimeouts();

				expect(conversation.state.checkpoint).toBeNull();
				for (let i = 0; i < 100 && held.finish === undefined; i++) {
					await Bun.sleep(1);
				}
				await finish(conversation);
				expect(conversation.state.checkpoint).toBeNull();
			});

			it("lets a merging turn finish, then checkpoints after it", async () => {
				const conversation = await working();

				await conversation.checkpoint(true);

				expect(agent.cancelled).toBe(0);
				expect(conversation.state.checkpoint).toBe("asked");
				held.finish?.("end_turn");
				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(1);
				}
				expect(said).toEqual(["one", CHECKPOINT]);
				expect(conversation.state.checkpoint).toBe("asked");
				await finish(conversation);
				expect(conversation.state.checkpoint).toBe("done");
			});

			it("gives up on an agent that does not answer in time", async () => {
				const conversation = await started();

				await conversation.checkpoint(false);
				timer.fireTimeouts();

				expect(conversation.state.checkpoint).toBe("unanswered");
				for (let i = 0; i < 100 && held.finish === undefined; i++) {
					await Bun.sleep(1);
				}
				await finish(conversation);
				expect(conversation.state.checkpoint).toBe("unanswered");
			});

			it("gives up on an agent that does not stop its turn", async () => {
				const conversation = await working();

				const asking = conversation.checkpoint(false);
				for (let i = 0; i < 100 && agent.cancelled === 0; i++) {
					await Bun.sleep(1);
				}
				timer.fireTimeouts();
				await asking;

				expect(conversation.state.checkpoint).toBe("unanswered");
				expect(said).toEqual(["one"]);
				await finish(conversation);
			});

			it("keeps where it stands in the log, carrying on after a restart only when told", async () => {
				const conversation = await started();
				await conversation.checkpoint(false);
				for (let i = 0; i < 100 && held.finish === undefined; i++) {
					await Bun.sleep(1);
				}
				await finish(conversation);

				await conversation.stop();
				const [read] = await new Conversations(
					"/repo/.git/arbor/conversations",
					[AGENT],
					{ fs, timer, clock, launch: agent.launch },
				).list();

				expect(read?.state.checkpoint).toBe("done");
				expect(read?.stoppedByCheckpoint).toBe(true);
				await read?.prompt(RESUME);
				expect(read?.state.checkpoint).toBeNull();
				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(1);
				}
				await finish(read as Conversation);
			});

			it("fails when the agent dies before it answers", async () => {
				const conversation = await started();

				await conversation.checkpoint(false);
				agent.crash();
				await until(conversation, "failed");

				expect(conversation.state.checkpoint).toBe("failed");
			});
		});

		it("takes back a queued message, answering with its words", async () => {
			const conversation = await working();
			await conversation.prompt("two");
			await conversation.prompt("three");

			expect(conversation.unqueue(0)).toEqual({ text: "two", images: [] });

			expect(thread(conversation)).toEqual([
				["one", false],
				["three", true],
			]);
			expect(() => conversation.unqueue(5)).toThrow(
				"conversation 0 has no queued message 5",
			);
			await conversation.stop();
			const reread = new Conversations(
				"/repo/.git/arbor/conversations",
				[AGENT],
				{ fs, timer, launch: agent.launch },
			);
			const [read] = await reread.list();
			expect(read && thread(read)).toEqual([
				["one", false],
				["three", true],
			]);
			await reread.disposeAsync();
		});

		it("sends what is queued now by stopping the turn", async () => {
			agent.turn = (_client, _session, text) => {
				said.push(text);
				return new Promise((resolve) => (held.finish = resolve));
			};
			const conversation = await working();
			await conversation.prompt("two");

			await conversation.sendNow();
			// The agent stops the turn it was asked to cancel.
			held.finish?.("cancelled");
			for (let i = 0; i < 100 && said.length < 2; i++) {
				await Bun.sleep(1);
			}

			expect(agent.cancelled).toBe(1);
			expect(said).toEqual(["one", "two"]);
			// Stopped to send, not by the person.
			expect(conversation.state.messages.some((each) => each.stopped)).toBe(
				false,
			);
			await finish(conversation);
		});

		it("reads back what still waits from its log", async () => {
			const conversation = await working();
			await conversation.prompt("two");
			await conversation.stop();

			const reread = new Conversations(
				"/repo/.git/arbor/conversations",
				[AGENT],
				{ fs, timer, launch: agent.launch },
			);
			const [read] = await reread.list();

			expect(read && thread(read)).toEqual([
				["one", false],
				["two", true],
			]);
			await reread.disposeAsync();
		});
	});

	it("finds one while another caller is still reading them back", async () => {
		const conversation = await started();
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);

		// As a page listing a project just opened while it prompts one.
		const [listed, found] = await Promise.all([
			reread.list(),
			reread.find(conversation.id),
		]);

		expect(found.id).toBe(conversation.id);
		expect(listed.map((each) => each.id)).toEqual([conversation.id]);
		await reread.disposeAsync();
	});

	it("holds a permission request until the person picks an option", async () => {
		const seen: { outcome?: acp.RequestPermissionOutcome } = {};
		agent.turn = async (client, sessionId) => {
			({ outcome: seen.outcome } = await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "t1", title: "rm -rf build" },
				options: [
					{ optionId: "yes", name: "Allow", kind: "allow_once" },
					{ optionId: "no", name: "Reject", kind: "reject_once" },
				],
			}));
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("clean up");
		for (let i = 0; i < 100 && conversation.state.ask === null; i++) {
			await Bun.sleep(1);
		}

		expect(conversation.state.ask).toEqual({
			type: "permission",
			id: "t1",
			at: expect.any(String),
			title: "rm -rf build",
			options: [
				{ id: "yes", name: "Allow", kind: "allow_once" },
				{ id: "no", name: "Reject", kind: "reject_once" },
			],
		});
		conversation.answer("t1", { type: "permission", option: "no" });
		await until(conversation, "idle");

		expect(conversation.state.ask).toBeNull();
		expect(seen.outcome).toEqual({ outcome: "selected", optionId: "no" });
	});

	it("keeps how a permission was answered on its tool call, and in the log", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "rm -rf build",
					kind: "execute",
				},
			});
			await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "t1", title: "rm -rf build" },
				options: [
					{ optionId: "yes", name: "Allow", kind: "allow_once" },
					{ optionId: "no", name: "Reject", kind: "reject_once" },
				],
			});
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("clean up");
		for (let i = 0; i < 100 && conversation.state.ask === null; i++) {
			await Bun.sleep(1);
		}
		conversation.answer("t1", { type: "permission", option: "yes" });
		await until(conversation, "idle");
		const decisions = (each: Conversation) =>
			each.state.messages.flatMap((message) =>
				message.parts.flatMap((part) =>
					part.type === "tool" ? [[part.title, part.decision?.option]] : [],
				),
			);

		expect(decisions(conversation)).toEqual([
			["rm -rf build", { name: "Allow", kind: "allow_once" }],
		]);
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read && decisions(read)).toEqual([
			["rm -rf build", { name: "Allow", kind: "allow_once" }],
		]);
		await reread.disposeAsync();
	});

	it("adds up the tokens each turn used and what the session cost, through a restart", async () => {
		agent.usage = {
			inputTokens: 10,
			cachedReadTokens: 900,
			cachedWriteTokens: 90,
			outputTokens: 50,
			totalTokens: 1050,
		};
		let cost = 0;
		agent.turn = async (client, sessionId) => {
			cost += 0.5;
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "usage_update",
					used: 40_000,
					size: 200_000,
					cost: { amount: cost, currency: "USD" },
				},
			});
			return "end_turn";
		};
		const conversation = await started();

		await conversation.prompt("one");
		await until(conversation, "idle");
		await conversation.prompt("two");
		await until(conversation, "idle");
		// Claude counts cost from naught again in a new process.
		await conversation.stop();
		cost = 0;
		await conversation.prompt("three");
		await until(conversation, "idle");

		const usage = {
			context: { used: 40_000, size: 200_000 },
			input: 3000,
			cached: 2700,
			output: 150,
			cost: { amount: 1.5, currency: "USD", said: 0.5 },
		};
		expect(conversation.state.usage).toEqual(usage);
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.usage).toEqual(usage);
		await reread.disposeAsync();
	});

	it("asks the person an agent's question form and hands back the answer", async () => {
		const seen: { response?: acp.CreateElicitationResponse } = {};
		agent.turn = async (client, sessionId) => {
			seen.response = await client.createElicitation({
				sessionId,
				mode: "form",
				message: "Uppercase the note?",
				requestedSchema: {
					type: "object",
					properties: {
						question_0: {
							type: "string",
							title: "Uppercase",
							oneOf: [
								{ const: "yes", title: "Yes", description: "Shout it" },
								{ const: "no", title: "No" },
							],
						},
						question_0_custom: {
							type: "string",
							title: "Other",
							description: "Your own answer",
						},
					},
				},
			} as acp.CreateElicitationRequest);
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("tidy the note");
		for (let i = 0; i < 100 && conversation.state.ask === null; i++) {
			await Bun.sleep(1);
		}
		const ask = conversation.state.ask;

		expect(ask).toMatchObject({
			type: "question",
			message: "Uppercase the note?",
			fields: [
				{
					key: "question_0",
					title: "Uppercase",
					description: null,
					choices: [
						{ value: "yes", title: "Yes", description: "Shout it" },
						{ value: "no", title: "No", description: null },
					],
				},
				{
					key: "question_0_custom",
					title: "Other",
					description: "Your own answer",
					choices: null,
				},
			],
		});
		conversation.answer(ask?.id ?? "", {
			type: "question",
			values: { question_0: "yes" },
		});
		await until(conversation, "idle");

		expect(seen.response).toEqual({
			action: "accept",
			content: { question_0: "yes" },
		});
	});

	it("cancels a turn, dismissing what it was asking", async () => {
		const seen: { outcome?: acp.RequestPermissionOutcome } = {};
		agent.turn = async (client, sessionId) => {
			({ outcome: seen.outcome } = await client.requestPermission({
				sessionId,
				toolCall: { toolCallId: "t1", title: "deploy" },
				options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }],
			}));
			return "cancelled";
		};
		const conversation = await started();
		await conversation.prompt("ship it");
		for (let i = 0; i < 100 && conversation.state.ask === null; i++) {
			await Bun.sleep(1);
		}

		await conversation.cancel();
		await until(conversation, "idle");

		expect(agent.cancelled).toBe(1);
		expect(seen.outcome).toEqual({ outcome: "cancelled" });
		expect(conversation.state.ask).toBeNull();
		// Asked before the agent said it was making the call, which shows anyway.
		expect(conversation.state.messages[1]?.parts).toMatchObject([
			{ type: "tool", title: "deploy", decision: { option: null } },
		]);
	});

	it("switches a setting to a value the agent offers, and refuses any other", async () => {
		const conversation = await started();

		await conversation.choose("model", "small");
		expect(
			conversation.state.settings.find((each) => each.id === "model")?.current,
		).toBe("small");
		await expect(conversation.choose("model", "huge")).rejects.toThrow(
			"'huge' is not a model this agent offers",
		);
		await expect(conversation.choose("size", "huge")).rejects.toThrow(
			"has no setting 'size'",
		);
	});

	it("takes a setting while stopped, and sets it as the session resumes", async () => {
		const conversation = await started();
		await conversation.stop();

		await conversation.choose("model", "small");
		expect(
			conversation.state.settings.find((each) => each.id === "model")?.current,
		).toBe("small");
		expect(agent.chosen).toEqual([]);

		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
	});

	it("keeps a setting picked while stopped across a restart", async () => {
		const conversation = await started();
		await conversation.stop();
		await conversation.choose("mode", "auto");
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		// A new agent process: what it starts with is its own default.
		agent.chosen = [];

		await read?.prompt("go on");
		await until(read as Conversation, "idle");
		expect(agent.chosen).toEqual([{ configId: "mode", value: "auto" }]);
		await reread.disposeAsync();
	});

	it("moves into a task's tree and back, and resumes where it was moved to", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();

		conversation.move("signup", "/repo-arbor/signup", "task/auth");

		expect(conversation.state.task).toBe("signup");
		expect(conversation.state.lastTask).toBe("signup");
		expect(conversation.state.lastBase).toBe("task/auth");
		await conversation.stop();
		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo-arbor/signup");

		conversation.move(null, "/repo");
		expect(conversation.state.lastTask).toBe("signup");
		expect(conversation.state.lastBase).toBe("task/auth");
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.task).toBeNull();
		expect(read?.state.lastTask).toBe("signup");
		expect(read?.state.lastBase).toBe("task/auth");
		await read?.prompt("and on");
		await until(read as Conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
		await reread.disposeAsync();
	});

	it("resumes in the main tree once its task's worktree is gone", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();
		await conversation.stop();
		await fs.rm("/repo-arbor/login", { recursive: true });
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch, root: "/repo" },
		);
		const [read] = await reread.list();

		await read?.prompt("go on");
		await until(read as Conversation, "idle");

		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
		expect(read?.state.task).toBeNull();
		expect(read?.state.lastTask).toBe("login");
		await reread.disposeAsync();
	});

	it("says why it cannot resume once its tree is gone and no main tree is known", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();
		await conversation.stop();
		await fs.rm("/repo-arbor/login", { recursive: true });

		await expect(conversation.prompt("go on")).rejects.toThrow(
			"/repo-arbor/login is gone",
		);
		expect(agent.launched).toHaveLength(1);
	});

	it("takes a prompt while still starting, and says it once the session is open", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Hi.") });
			return "end_turn";
		};
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		expect(conversation.state.status).toBe("starting");

		await conversation.prompt("hello");
		await until(conversation, "idle");

		expect(conversation.state.messages).toMatchObject([
			{ role: "user", parts: [{ type: "text", text: "hello" }] },
			{ role: "agent", parts: [{ type: "text", text: "Hi." }] },
		]);
	});

	it("stops the agent, reads back from its log, and resumes on the next prompt", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Done.") });
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("do it");
		await until(conversation, "idle");

		await conversation.stop();

		expect(agent.killed).toBe(1);
		expect(conversation.state.status).toBe("stopped");
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state).toMatchObject({
			id: "0",
			agent: "fake",
			task: "login",
			status: "stopped",
			settings: [
				{ id: "mode" },
				{ id: "model", current: "big" },
				{ id: "fast", current: "off" },
			],
			messages: [
				{ role: "user", parts: [{ type: "text", text: "do it" }] },
				{ role: "agent", parts: [{ type: "text", text: "Done." }] },
			],
		});

		await read?.prompt("again");
		await until(read as Conversation, "idle");

		expect(agent.resumed).toEqual(["s1"]);
		expect(agent.opened).toEqual([ASK_IN_ARBOR, ASK_IN_ARBOR]);
		expect(agent.launched.at(-1)?.cwd).toBe(agent.launched[0]?.cwd ?? "");
		expect(read?.state.messages.at(-1)).toMatchObject({
			role: "agent",
			parts: [{ type: "text", text: "Done." }],
		});
		await reread.disposeAsync();
	});

	describe("background commands", () => {
		/** A turn that starts `command` in the background as `id`, then more. */
		const leaves = (
			id: string,
			command: string,
			...after: acp.SessionUpdate[]
		) => {
			agent.turn = async (client, sessionId) => {
				await client.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "tool_call",
						toolCallId: `t-${id}`,
						title: command,
						kind: "execute",
						status: "completed",
						rawInput: { command, run_in_background: true },
					},
				});
				for (const update of [
					backgroundStarted(id, `Run ${command}`, `t-${id}`),
					...after,
				]) {
					await client.sessionUpdate({ sessionId, update });
				}
				return "end_turn";
			};
		};

		it("asks Claude to say when one starts and ends", async () => {
			await started();

			expect(agent.capabilities?._meta).toEqual({
				jetbrains: { air: { version: 1, capabilities: ["asyncTasks"] } },
			});
		});

		it("lists each one running, by what it is for, with its command and where it writes", async () => {
			leaves("b1", "bun dev", backgroundWrites("b1", "/tmp/tasks/b1.output"));
			const conversation = await started();

			await conversation.prompt("serve it");
			await until(conversation, "idle");

			expect(conversation.state.background).toEqual([
				{
					id: "b1",
					name: "Run bun dev",
					command: "bun dev",
					state: "running",
					output: "/tmp/tasks/b1.output",
				},
			]);
		});

		it("keeps one once it ends, as it ended, and leaves out what is not a command", async () => {
			leaves(
				"b1",
				"bun test",
				backgroundStarted("w1", "A workflow", "t-w1", "workflow"),
				backgroundEnded("b1", "failed"),
			);
			const conversation = await started();

			await conversation.prompt("test it");
			await until(conversation, "idle");

			expect(
				conversation.state.background.map(({ id, state }) => [id, state]),
			).toEqual([["b1", "failed"]]);
		});

		it("follows what one prints, ending once it has and all of it is read", async () => {
			const output = "/tmp/tasks/b1.output";
			await fs.mkdir("/tmp/tasks");
			await fs.write(output, "building\n");
			leaves("b1", "bun build", backgroundWrites("b1", output));
			const conversation = await started();
			await conversation.prompt("build it");
			await until(conversation, "idle");
			const reader = conversation.backgroundOutput("b1").getReader();
			const decoder = new TextDecoder();
			const next = async () => {
				const { value, done } = await reader.read();
				return done ? null : decoder.decode(value);
			};

			expect(await next()).toBe("building\n");
			await fs.append(output, "built\n");
			timer.fireTimeouts();
			expect(await next()).toBe("built\n");
			await agent.say(backgroundEnded("b1", "completed"));
			for (
				let i = 0;
				i < 100 && conversation.state.background[0]?.state === "running";
				i++
			) {
				await Bun.sleep(1);
			}
			await fs.append(output, "done\n");
			timer.fireTimeouts();
			expect(await next()).toBe("done\n");
			expect(await next()).toBeNull();
		});

		it("stops one, leaving the conversation as it was", async () => {
			leaves("b1", "bun dev");
			const conversation = await started();
			await conversation.prompt("serve it");
			await until(conversation, "idle");

			await conversation.stopBackground("b1");

			expect(agent.stoppedBackground).toEqual(["b1"]);
			expect(conversation.state.background.map((each) => each.state)).toEqual([
				"stopped",
			]);
			expect(conversation.state.status).toBe("idle");
			expect(agent.cancelled).toBe(0);
		});

		it("refuses to stop one it does not have", async () => {
			const conversation = await started();

			await expect(conversation.stopBackground("b9")).rejects.toThrow(
				"has no background command b9",
			);
			expect(agent.stoppedBackground).toEqual([]);
		});

		it("forgets them as its process ends, and as it reads back the log", async () => {
			leaves("b1", "bun dev");
			const conversation = await started();
			await conversation.prompt("serve it");
			await until(conversation, "idle");

			await conversation.stop();

			expect(conversation.state.background).toEqual([]);
			const reread = new Conversations(
				"/repo/.git/arbor/conversations",
				[AGENT],
				{ fs, timer, launch: agent.launch },
			);
			const [back] = await reread.list();
			expect(back?.state.background).toEqual([]);
			await reread.disposeAsync();
		});
	});

	describe("brought in", () => {
		beforeEach(() => {
			agent.held = [
				{
					sessionId: "cli-1",
					cwd: "/repo-arbor/login",
					title: "Fix login",
					updatedAt: "2026-10-11T09:00:00Z",
					replay: [
						heard("fix the "),
						heard("login"),
						say("Fixed."),
						heard("thanks"),
						say("Welcome."),
					],
				},
				{
					sessionId: "cli-2",
					cwd: "/repo-arbor/login",
					updatedAt: "2026-10-11T09:30:00Z",
					replay: [],
				},
				{
					sessionId: "cli-3",
					cwd: "/repo-arbor/other",
					replay: [],
				},
			];
		});

		it("lists each agent's sessions in the tree, newest first, from a process that stops", async () => {
			const sessions = await conversations.sessions("/repo-arbor/login");

			expect(sessions).toEqual([
				{
					agent: "fake",
					session: "cli-2",
					title: null,
					updatedAt: "2026-10-11T09:30:00Z",
				},
				{
					agent: "fake",
					session: "cli-1",
					title: "Fix login",
					updatedAt: "2026-10-11T09:00:00Z",
				},
			]);
			expect(agent.launched).toEqual([
				{ argv: ["fake-acp"], cwd: "/repo-arbor/login", env: {} },
			]);
			expect(agent.killed).toBe(1);
		});

		it("lists none from an agent that cannot list and load them", async () => {
			agent.held = null;

			expect(await conversations.sessions("/repo-arbor/login")).toEqual([]);
		});

		it("loads one into a log of its own, replayed, and resumes it after", async () => {
			const conversation = await conversations.bring("fake", "cli-1", {
				task: "login",
				cwd: "/repo-arbor/login",
				title: "Fix login",
			});
			await until(conversation, "idle");

			expect(agent.loaded).toEqual(["cli-1"]);
			expect(agent.opened).toEqual([ASK_IN_ARBOR]);
			expect(conversation.state).toMatchObject({
				task: "login",
				title: "Fix login",
				messages: [
					{ role: "user", parts: [{ type: "text", text: "fix the login" }] },
					{ role: "agent", parts: [{ type: "text", text: "Fixed." }] },
					{ role: "user", parts: [{ type: "text", text: "thanks" }] },
					{ role: "agent", parts: [{ type: "text", text: "Welcome." }] },
				],
			});
			expect(
				(await conversations.sessions("/repo-arbor/login")).map(
					(each) => each.session,
				),
			).toEqual(["cli-2"]);

			await conversation.stop();
			const reread = new Conversations(
				"/repo/.git/arbor/conversations",
				[AGENT],
				{ fs, timer, clock, launch: agent.launch },
			);
			const [read] = await reread.list();
			expect(read?.state).toMatchObject({
				title: "Fix login",
				messages: conversation.state.messages,
			});
			await read?.prompt("again");
			await until(read as Conversation, "idle");
			expect(agent.resumed).toEqual(["cli-1"]);
			expect(agent.loaded).toEqual(["cli-1"]);
			await reread.disposeAsync();
		});

		it("refuses a session a conversation already holds", async () => {
			const conversation = await conversations.bring("fake", "cli-1", {
				task: "login",
				cwd: "/repo-arbor/login",
			});
			await until(conversation, "idle");

			await expect(
				conversations.bring("fake", "cli-1", {
					task: "login",
					cwd: "/repo-arbor/login",
				}),
			).rejects.toMatchObject({ reason: "usage" });
		});
	});

	describe("images", () => {
		const PNG = { mimeType: "image/png", data: btoa("png bytes") };

		it("sends images ahead of the words, keeps them beside the log, and reads them back", async () => {
			agent.sees = true;
			const conversation = await started();

			await conversation.prompt("look", [PNG]);
			await until(conversation, "idle");

			expect(agent.prompts).toEqual([
				[
					{ type: "image", mimeType: "image/png", data: PNG.data },
					{ type: "text", text: "look" },
				],
			]);
			const image = conversation.state.messages[0]?.parts[0];
			expect(image).toEqual({
				type: "image",
				name: expect.stringMatching(/^[0-9a-f]{16}\.png$/),
				mimeType: "image/png",
			});
			const name = image?.type === "image" ? image.name : "";
			const kept = await conversation.image(name);
			expect(new TextDecoder().decode(kept?.bytes)).toBe("png bytes");
			expect(kept?.mimeType).toBe("image/png");
			expect(await conversation.image("other.png")).toBeNull();
			await conversation.stop();
			const reread = new Conversations(
				"/repo/.git/arbor/conversations",
				[AGENT],
				{ fs, timer, clock, launch: agent.launch },
			);
			const [read] = await reread.list();
			expect(read?.state.messages[0]?.parts).toEqual([
				{ type: "image", name, mimeType: "image/png" },
				{ type: "text", text: "look" },
			]);
			expect((await read?.image(name))?.mimeType).toBe("image/png");
		});

		it("sends an image with no words", async () => {
			agent.sees = true;
			const conversation = await started();

			await conversation.prompt("", [PNG]);
			await until(conversation, "idle");

			expect(agent.prompts).toEqual([
				[{ type: "image", mimeType: "image/png", data: PNG.data }],
			]);
		});

		it("refuses images to an agent that does not take them, and images it cannot be sent", async () => {
			const conversation = await started();

			await expect(conversation.prompt("look", [PNG])).rejects.toThrow(
				"Fake does not take images",
			);
			await expect(
				conversation.prompt("look", [{ mimeType: "image/svg+xml", data: "" }]),
			).rejects.toThrow(
				"send a PNG, JPEG, GIF or WebP image, not image/svg+xml",
			);
			expect(conversation.state.messages).toEqual([]);
			expect(agent.prompts).toEqual([]);
		});
	});

	it("keeps a name the person gives over the agent's title, and reads it back", async () => {
		const conversation = await started();

		await conversation.rename("  Login redirect ");

		expect(conversation.state.name).toBe("Login redirect");
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		expect((await reread.list())[0]?.state.name).toBe("Login redirect");
		await conversation.rename("");
		expect(conversation.state.name).toBeNull();
	});

	it("is unread once a turn ends until marked read, and reads it back", async () => {
		const conversation = await started();
		expect(conversation.state.unread).toBe(false);

		await conversation.prompt("hello");
		await until(conversation, "idle");

		expect(conversation.state.unread).toBe(true);
		await conversation.markUnread(false);
		expect(conversation.state.unread).toBe(false);
		const reread = () =>
			new Conversations("/repo/.git/arbor/conversations", [AGENT], {
				fs,
				timer,
				clock,
				launch: agent.launch,
			}).list();
		expect((await reread())[0]?.state.unread).toBe(false);
		await conversation.markUnread(true);
		expect((await reread())[0]?.state.unread).toBe(true);
	});

	it("counts the messages seen when last marked read, and reads it back", async () => {
		const conversation = await started();
		await conversation.prompt("hello");
		await until(conversation, "idle");
		await conversation.markUnread(false);
		const seen = conversation.state.messages.length;
		expect(conversation.state.seen).toBe(seen);

		await conversation.prompt("again");
		await until(conversation, "idle");

		expect(conversation.state.seen).toBe(seen);
		const reread = await new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		).list();
		expect(reread[0]?.state.seen).toBe(seen);
		expect(reread[0]?.state.messages.length).toBeGreaterThan(seen);
	});

	it("archives by stopping the agent, and is unarchived by a prompt", async () => {
		const conversation = await started();

		await conversation.archive();

		expect(agent.killed).toBe(1);
		expect(conversation.state).toMatchObject({
			status: "stopped",
			archived: true,
		});

		await conversation.prompt("again");

		expect(conversation.state.archived).toBe(false);
		expect(conversation.state.status).not.toBe("stopped");
	});

	it("archives until unarchived, even across a reread", async () => {
		const conversation = await started();

		await conversation.archive();

		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		expect((await reread.list())[0]?.state.archived).toBe(true);

		await conversation.unarchive();

		expect(conversation.state.archived).toBe(false);
	});

	describe("archived past the newest kept", () => {
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

	it("fails with the agent's last words when it dies on its own", async () => {
		const conversation = await started();

		agent.crash();
		await until(conversation, "failed");

		expect(conversation.state.error).toBe("fake agent fell over");
	});

	it("stamps what is said with when, and reads the times back from the log", async () => {
		agent.turn = async (client, sessionId) => {
			clock.advance(Duration.secs(3));
			await client.sessionUpdate({ sessionId, update: say("Done.") });
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("go");
		await until(conversation, "idle");
		await conversation.stop();

		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(
			read?.state.messages.map(({ at, until }) => ({ at, until })),
		).toEqual([
			{ at: "2026-10-11T10:00:00.000Z", until: "2026-10-11T10:00:00.000Z" },
			{ at: "2026-10-11T10:00:03.000Z", until: "2026-10-11T10:00:03.000Z" },
		]);
		await reread.disposeAsync();
	});

	it("saves a streaming log at most once per interval, and all of it on stop", async () => {
		agent.turn = async (client, sessionId) => {
			for (const word of ["a", "b", "c"]) {
				await client.sessionUpdate({ sessionId, update: say(word) });
			}
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("go");
		await until(conversation, "idle");
		const log = "/repo/.git/arbor/conversations/0.jsonl";
		await Bun.sleep(1);

		// The start went out at once; the rest wait for the timer.
		expect((await fs.read(log)).trim().split("\n")).toHaveLength(1);
		await conversation.stop();
		const lines = (await fs.read(log)).trim().split("\n");
		expect(lines.map((line) => JSON.parse(line).kind)).toEqual([
			"start",
			"session",
			"settings",
			"prompt",
			"update",
			"update",
			"update",
			"unread",
			"end",
		]);
	});

	it("flags a command for what it did to git, and keeps the flag in the log", async () => {
		await using env = await Testing.open();
		await env.fs.write(join(env.root, "README.md"), "edited\n");
		// the command waits for the look before it, which a loaded machine slows
		const looked = Promise.withResolvers<void>();
		const watch = new (class extends Watch {
			override command(cwd: string) {
				const watched = super.command(cwd);
				void watched.looked().then(looked.resolve);
				return watched;
			}
		})(env.git);
		const watching = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch, watch },
		);
		const command = (id: string, status: "in_progress" | "completed") =>
			({
				sessionUpdate:
					id === "t1" && status === "in_progress"
						? "tool_call"
						: "tool_call_update",
				toolCallId: id,
				title: "git stash",
				kind: "execute",
				status,
			}) as acp.SessionUpdate;
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: command("t1", "in_progress"),
			});
			await looked.promise;
			await env.gitCli(env.root, "stash");
			await client.sessionUpdate({
				sessionId,
				update: command("t1", "completed"),
			});
			return "end_turn";
		};
		const conversation = await watching.start("fake", {
			task: null,
			cwd: env.root,
		});
		await until(conversation, "idle");

		await conversation.prompt("stash it");
		await until(conversation, "idle");
		const flagged = (each: Conversation) =>
			new Promise<unknown>((resolve) => {
				const check = () => {
					const part = each.state.messages[1]?.parts[0];
					if (part?.type === "tool" && part.flags.length > 0) {
						off();
						resolve(part.flags);
					}
				};
				const off = each.events.on("changed", check);
				check();
			});

		expect(await flagged(conversation)).toEqual([
			{ type: "stashed", count: 1 },
		]);
		await conversation.stop();
		const [read] = await new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		).list();
		expect(await flagged(read as Conversation)).toEqual([
			{ type: "stashed", count: 1 },
		]);
		await watching.disposeAsync();
	});
});

describe("launch", () => {
	it("ends an agent that cannot start as one that exited saying why", async () => {
		const agent = launch(["sh"], "/no/such/tree", {});

		expect(await agent.exited).toBe(127);
		expect(agent.stderr()).toStartWith("cannot start sh in /no/such/tree: ");
		expect(agent.output.getReader().read()).rejects.toThrow();
	});
});

describe("fold", () => {
	const state = (): ConversationState => ({
		id: "c",
		agent: "claude",
		task: null,
		lastTask: null,
		lastBase: null,
		title: null,
		name: null,
		status: "running",
		error: null,
		messages: [],
		ask: null,
		settings: [],
		commands: [],
		createdAt: "2026-10-11T10:00:00.000Z",
		archived: false,
		unread: false,
		seen: 0,
		checkpoint: null,
		usage: unused(),
		background: [],
	});
	const at = (secs: number) =>
		new Date(Date.parse("2026-10-11T10:00:00Z") + secs * 1000).toISOString();

	it("keeps how full the context is, but not a subagent's", () => {
		const into = state();

		fold(into, { sessionUpdate: "usage_update", used: 10, size: 100 });
		fold(into, {
			sessionUpdate: "usage_update",
			used: 90,
			size: 100,
			_meta: { claudeCode: { parentToolUseId: "t1" } },
		});

		expect(into.usage).toEqual({
			...unused(),
			context: { used: 10, size: 100 },
		});
	});

	it("keeps the skills and commands the agent last said it has", () => {
		const into = state();

		fold(into, {
			sessionUpdate: "available_commands_update",
			availableCommands: [{ name: "init", description: "Write a CLAUDE.md" }],
		});
		fold(into, {
			sessionUpdate: "available_commands_update",
			availableCommands: [
				{ name: "arbor", description: "Land work on trunk" },
				{
					name: "code-review",
					description: "Review the diff",
					input: { hint: "low|medium|high" },
				},
			],
		});

		expect(into.commands).toEqual([
			{ name: "arbor", description: "Land work on trunk", hint: null },
			{
				name: "code-review",
				description: "Review the diff",
				hint: "low|medium|high",
			},
		]);
	});

	it("keeps a command, its output, and how long it ran, as Claude sends them", () => {
		const into = state();
		const updates: acp.SessionUpdate[] = [
			{
				sessionUpdate: "tool_call",
				toolCallId: "t1",
				title: "Terminal",
				kind: "execute",
				status: "pending",
				content: [],
				rawInput: {},
			},
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "t1",
				title: "bun test",
				rawInput: { command: "bun test" },
			},
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "t1",
				content: [
					{ type: "content", content: { type: "text", text: "Run the tests" } },
				],
			},
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "t1",
				status: "failed",
				content: [
					{
						type: "content",
						content: { type: "text", text: "```console\n1 fail\n```" },
					},
				],
			},
		];
		for (const [index, update] of updates.entries()) {
			fold(into, update, at(index * 10));
		}

		expect(into.messages[0]?.parts).toEqual([
			{
				type: "tool",
				id: "t1",
				title: "bun test",
				status: "failed",
				kind: "execute",
				command: "bun test",
				target: null,
				output: "1 fail",
				edits: [],
				paths: [],
				parent: null,
				at: at(0),
				until: at(30),
				flags: [],
				decision: null,
			},
		]);
		expect(into.messages[0]).toMatchObject({ at: at(0), until: at(30) });
	});

	it("streams a command's output and fails it on a nonzero exit, as Codex sends them", () => {
		const into = state();
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "x1",
			title: "wc -l note.txt",
			kind: "execute",
			status: "in_progress",
			rawInput: { command: ["wc", "-l", "note.txt"] },
		});
		fold(into, {
			sessionUpdate: "tool_call_update",
			toolCallId: "x1",
			_meta: { terminal_output_delta: { data: "no such file\n" } },
		});
		fold(into, {
			sessionUpdate: "tool_call_update",
			toolCallId: "x1",
			status: "completed",
			_meta: { terminal_exit: { exit_code: 1 } },
		});

		expect(into.messages[0]?.parts[0]).toMatchObject({
			command: "wc -l note.txt",
			output: "no such file\n",
			status: "failed",
		});
	});

	it("keeps what a call searches for or fetches, as its input names it", () => {
		const into = state();
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "g1",
			title: "grep",
			kind: "search",
			rawInput: { pattern: "fold\\(" },
		});
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "f1",
			title: "Fetch",
			kind: "fetch",
			rawInput: { url: "https://example.com" },
		});

		expect(
			into.messages[0]?.parts.map((part) =>
				part.type === "tool" ? part.target : null,
			),
		).toEqual(["fold\\(", "https://example.com"]);
	});

	it("keeps an edit's file and its change", () => {
		const into = state();
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "w1",
			title: "Write note.txt",
			kind: "edit",
			locations: [{ path: "/repo/note.txt" }],
		});
		fold(into, {
			sessionUpdate: "tool_call_update",
			toolCallId: "w1",
			status: "completed",
			content: [
				{ type: "diff", path: "/repo/note.txt", oldText: "hi", newText: "HI" },
			],
		});

		expect(into.messages[0]?.parts[0]).toMatchObject({
			paths: ["/repo/note.txt"],
			edits: [{ path: "/repo/note.txt", old: "hi", new: "HI" }],
		});
	});

	it("files a subagent's tool calls under its own, and leaves out its words", () => {
		const into = state();
		const under = { claudeCode: { parentToolUseId: "a1" } };
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "a1",
			title: "Find the callers",
			kind: "think",
		});
		fold(into, {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "Searching." },
			_meta: under,
		});
		fold(into, {
			sessionUpdate: "tool_call",
			toolCallId: "g1",
			title: "grep fold",
			kind: "search",
			_meta: under,
		});

		expect(
			into.messages[0]?.parts.map((part) =>
				part.type === "tool" ? [part.id, part.parent] : part.type,
			),
		).toEqual([
			["a1", null],
			["g1", "a1"],
		]);
	});

	it("keeps when the agent began saying something, not when it went on", () => {
		const into = state();
		for (const [text, second] of [
			["Now ", 0],
			["the fix.", 3],
		] as const) {
			fold(
				into,
				{
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text },
				},
				at(second),
			);
		}

		expect(into.messages[0]?.parts).toEqual([
			{ type: "text", text: "Now the fix.", at: at(0) },
		]);
	});

	it("keeps the plan as last sent, and when a thought began", () => {
		const into = state();
		fold(
			into,
			{
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "Hmm" },
			},
			at(0),
		);
		fold(
			into,
			{
				sessionUpdate: "plan",
				entries: [
					{ content: "Read", priority: "high", status: "completed" },
					{ content: "Write", priority: "high", status: "in_progress" },
				],
			},
			at(5),
		);

		expect(into.messages[0]).toMatchObject({
			parts: [{ type: "thought", text: "Hmm", at: at(0) }],
			plan: [
				{ text: "Read", status: "completed" },
				{ text: "Write", status: "in_progress" },
			],
			until: at(5),
		});
	});
});
