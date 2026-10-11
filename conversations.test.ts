import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { type Conversation, Conversations, type Status } from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";

describe("Conversations", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(() => {
		fs = new FakeFs();
		timer = new FakeTimer();
		agent = new FakeAgent();
		conversations = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer,
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
		]);
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
		expect(conversation.state.messages).toEqual([
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

	it("refuses a prompt while the agent is still answering", async () => {
		const held: { finish?: (reason: acp.StopReason) => void } = {};
		agent.turn = () => new Promise((resolve) => (held.finish = resolve));
		const conversation = await started();
		await conversation.prompt("one");
		for (let i = 0; i < 100 && held.finish === undefined; i++) {
			await Bun.sleep(1);
		}

		await expect(conversation.prompt("two")).rejects.toThrow(
			"conversation 0 is running: wait for the agent, or cancel its turn",
		);
		held.finish?.("end_turn");
		await until(conversation, "idle");
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
			{ fs, timer, launch: agent.launch },
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
		await conversation.stop();
		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo-arbor/signup");

		conversation.move(null, "/repo");
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.task).toBeNull();
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

		expect(conversation.state.messages).toEqual([
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
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state).toMatchObject({
			id: "0",
			agent: "fake",
			task: "login",
			status: "stopped",
			settings: [{ id: "mode" }, { id: "model", current: "big" }],
			messages: [
				{ role: "user", parts: [{ type: "text", text: "do it" }] },
				{ role: "agent", parts: [{ type: "text", text: "Done." }] },
			],
		});

		await read?.prompt("again");
		await until(read as Conversation, "idle");

		expect(agent.resumed).toEqual(["s1"]);
		expect(agent.launched.at(-1)?.cwd).toBe(agent.launched[0]?.cwd ?? "");
		expect(read?.state.messages.at(-1)).toEqual({
			role: "agent",
			parts: [{ type: "text", text: "Done." }],
		});
		await reread.disposeAsync();
	});

	it("keeps a name the person gives over the agent's title, and reads it back", async () => {
		const conversation = await started();

		await conversation.rename("  Login redirect ");

		expect(conversation.state.name).toBe("Login redirect");
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
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
			{ fs, timer, launch: agent.launch },
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
});
