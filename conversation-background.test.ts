import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { until } from "./conversation-testing";
import { Conversations } from "./conversations";
import {
	AGENT,
	backgroundEnded,
	backgroundStarted,
	backgroundWrites,
	FakeAgent,
} from "./fake-agent";

describe("Conversation background", () => {
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
