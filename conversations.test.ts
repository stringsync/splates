import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import {
	CHECKPOINT,
	type Conversation,
	type ConversationState,
	Conversations,
	fold,
	RESUME,
	type Status,
} from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";
import { Testing } from "./testing";
import { Watch } from "./watch";

describe("Conversations", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(() => {
		fs = new FakeFs();
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

	const until = async (conversation: Conversation, status: Status) => {
		for (let i = 0; i < 100 && conversation.state.status !== status; i++) {
			await Bun.sleep(1);
		}
		expect(conversation.state.status).toBe(status);
	};

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

	it("refuses an agent it does not know", async () => {
		await expect(
			conversations.start("nobody", { task: null, cwd: "/repo" }),
		).rejects.toThrow("no agent 'nobody': use one of fake");
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

			it("carries on once done, when asked to continue", async () => {
				const conversation = await started();
				await conversation.checkpoint(false, "continue");
				for (let i = 0; i < 100 && held.finish === undefined; i++) {
					await Bun.sleep(1);
				}

				const finishing = held.finish;
				held.finish = undefined;
				finishing?.("end_turn");
				for (let i = 0; i < 100 && said.length < 2; i++) {
					await Bun.sleep(1);
				}

				expect(said).toEqual([CHECKPOINT, RESUME]);
				expect(conversation.state.checkpoint).toBeNull();
				await finish(conversation);
			});

			it("keeps where it stands in the log, to resume after the restart it was for", async () => {
				const conversation = await started();
				await conversation.checkpoint(false, "restart");
				for (let i = 0; i < 100 && held.finish === undefined; i++) {
					await Bun.sleep(1);
				}
				await finish(conversation);
				expect(conversation.resumes).toBe(true);

				await conversation.stop();
				const [read] = await new Conversations(
					"/repo/.git/arbor/conversations",
					[AGENT],
					{ fs, timer, clock, launch: agent.launch },
				).list();

				expect(read?.state.checkpoint).toBe("done");
				expect(read?.resumes).toBe(true);
				await read?.prompt(RESUME);
				expect(read?.state.checkpoint).toBeNull();
				expect(read?.resumes).toBe(false);
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

		conversation.move("signup", "/repo-arbor/signup");

		expect(conversation.state.task).toBe("signup");
		expect(conversation.state.lastTask).toBe("signup");
		await conversation.stop();
		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo-arbor/signup");

		conversation.move(null, "/repo");
		expect(conversation.state.lastTask).toBe("signup");
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.task).toBeNull();
		expect(read?.state.lastTask).toBe("signup");
		await read?.prompt("and on");
		await until(read as Conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
		await reread.disposeAsync();
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
		expect(agent.launched.at(-1)?.cwd).toBe(agent.launched[0]?.cwd ?? "");
		expect(read?.state.messages.at(-1)).toMatchObject({
			role: "agent",
			parts: [{ type: "text", text: "Done." }],
		});
		await reread.disposeAsync();
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

	it("archives by stopping the agent, and takes no prompt until unarchived", async () => {
		const conversation = await started();

		await conversation.archive();

		expect(agent.killed).toBe(1);
		expect(conversation.state).toMatchObject({
			status: "stopped",
			archived: true,
		});
		await expect(conversation.prompt("again")).rejects.toThrow(
			"is archived: unarchive it first",
		);
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		expect((await reread.list())[0]?.state.archived).toBe(true);

		await conversation.unarchive();

		expect(conversation.state.archived).toBe(false);
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
			"end",
		]);
	});

	it("flags a command for what it did to git, and keeps the flag in the log", async () => {
		await using env = await Testing.open();
		await env.fs.write(join(env.root, "README.md"), "edited\n");
		const watching = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch, watch: new Watch(env.git) },
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
			await Bun.sleep(50);
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
		const flagged = async (each: Conversation) => {
			for (let i = 0; i < 100; i++) {
				const part = each.state.messages[1]?.parts[0];
				if (part?.type === "tool" && part.flags.length > 0) {
					return part.flags;
				}
				await Bun.sleep(10);
			}
			return [];
		};

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

describe("fold", () => {
	const state = (): ConversationState => ({
		id: "c",
		agent: "claude",
		task: null,
		lastTask: null,
		title: null,
		name: null,
		status: "running",
		error: null,
		messages: [],
		ask: null,
		settings: [],
		createdAt: "2026-10-11T10:00:00.000Z",
		archived: false,
		checkpoint: null,
	});
	const at = (secs: number) =>
		new Date(Date.parse("2026-10-11T10:00:00Z") + secs * 1000).toISOString();

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
