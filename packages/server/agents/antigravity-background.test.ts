import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "core/id";
import type { ProcessEntry } from "core/system";
import { FakeFs, FakePs } from "core/system/testing";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import { Conversations } from "../conversations";
import { eventually, until } from "../conversations/testing";
import { LocalWorkerMachine } from "../workers";
import { exitCodeIn, taskIn, transcriptPath } from "./antigravity-background";
import { FakeAgent } from "./testing";

describe("Antigravity's backgrounded commands", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let agent: FakeAgent;
	let table: ProcessEntry[];
	let conversations: Conversations;
	let later: ((update: acp.SessionUpdate) => Promise<void>) | null;

	beforeEach(async () => {
		fs = new FakeFs();
		for (const tree of ["/repo", "/repo-splates/login"]) {
			await fs.mkdir(tree);
		}
		timer = new FakeTimer();
		agent = new FakeAgent();
		agent.pid = PID;
		table = [entry(PID, 1, "agy acp")];
		later = null;
		const machine = new LocalWorkerMachine(new FakePs(), fs);
		machine.processes = async () => [...table];
		conversations = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock: new FakeWallClock(Date.parse("2026-11-22T18:32:00Z")),
				ids: new CounterIdProvider(),
				launch: agent.launch,
				machine,
				antigravityHome: HOME,
			},
		);
	});

	afterEach(() => conversations.disposeAsync());

	/** Fires the timeout Antigravity's wait plus slack set. */
	const waitPassed = async () => {
		await eventually(() =>
			timer.timeouts.some((each) => each.delay.ms === 2000),
		);
		const index = timer.timeouts.findIndex((each) => each.delay.ms === 2000);
		timer.fireTimeout(index);
	};

	/**
	 * A turn that starts `COMMAND`, which Antigravity backgrounds as task 7
	 * when `transcribed`, and ends with it still running beside process 600.
	 */
	const backgrounding = async (transcribed: boolean) => {
		const conversation = await conversations.start("antigravity", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		agent.turn = async (client, sessionId) => {
			later = (update) => client.sessionUpdate({ sessionId, update });
			if (transcribed) {
				await fs.mkdir(`${HOME}/brain/${sessionId}/.system_generated/logs`);
				await fs.write(
					transcriptPath(HOME, sessionId),
					`${backgroundedStep(sessionId, 7, COMMAND)}\n`,
				);
			}
			await later(runCommand("in_progress"));
			await waitPassed();
			await eventually(() => conversation.state.background.length > 0);
			table.push(entry(600, PID, "bun /repo/mono/packages/cli/index.ts fix"));
			return "end_turn";
		};
		await conversation.prompt("test it");
		await until(conversation, "idle");
		return conversation;
	};

	it("lists one by its task id and log, on the tool call that ran it", async () => {
		const conversation = await backgrounding(true);
		const session = "s1";

		expect(conversation.state.background).toEqual([
			expect.objectContaining({
				id: `${session}/task-7`,
				command: COMMAND,
				state: "running",
				output: `${HOME}/brain/${session}/.system_generated/tasks/task-7.log`,
				canStop: false,
			}),
		]);
		const tool = conversation.state.messages
			.flatMap((each) => each.parts)
			.find((each) => each.type === "tool");
		expect(tool).toMatchObject({
			background: { id: `${session}/task-7`, state: "running" },
		});
	});

	it("leaves out the process it runs as, which the task already lists", async () => {
		const conversation = await backgrounding(true);
		await Bun.sleep(5);

		expect(conversation.state.background.map(({ pid }) => pid)).toEqual([
			undefined,
		]);
	});

	it("ends it failed with its exit code once the command exits", async () => {
		const conversation = await backgrounding(true);

		await later?.(
			runCommand(
				"completed",
				"Command exited with code 1.\n\nCommand output:\n",
			),
		);

		await eventually(
			() => conversation.state.background[0]?.state === "failed",
		);
		const tool = conversation.state.messages
			.flatMap((each) => each.parts)
			.find((each) => each.type === "tool");
		expect(tool).toMatchObject({
			background: { state: "failed", exitCode: 1 },
		});
	});

	it("still lists one its transcript does not name, with no log", async () => {
		const conversation = await backgrounding(false);

		expect(conversation.state.background).toEqual([
			expect.objectContaining({
				id: "antigravity:call_1",
				state: "running",
				output: null,
			}),
		]);
	});

	it("lists nothing for a command that ends within its wait", async () => {
		const conversation = await conversations.start("antigravity", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: runCommand("in_progress"),
			});
			await client.sessionUpdate({
				sessionId,
				update: runCommand("completed", "Command exited with code 0."),
			});
			return "end_turn";
		};
		await conversation.prompt("test it");
		await until(conversation, "idle");
		timer.fireTimeouts();
		await Bun.sleep(5);

		expect(conversation.state.background).toEqual([]);
	});

	it("finds the latest task for a command, past those taken", () => {
		const session = "s1";
		const transcript = [
			backgroundedStep(session, 3, COMMAND),
			backgroundedStep(session, 9, "sleep 60"),
			backgroundedStep(session, 12, COMMAND),
			"{not json",
		].join("\n");

		expect(taskIn(transcript, session, COMMAND)).toEqual({
			id: "s1/task-12",
			log: `${HOME}/brain/s1/.system_generated/tasks/task-12.log`,
		});
		expect(
			taskIn(transcript, session, COMMAND, new Set(["s1/task-12"])),
		).toMatchObject({ id: "s1/task-3" });
		expect(taskIn(transcript, "other", COMMAND)).toBeNull();
	});

	it("reads the exit code run_command reports", () => {
		expect(exitCodeIn("Command exited with code 2.\n")).toBe(2);
		expect(exitCodeIn("no code here")).toBeNull();
	});
});

const AGENT = { id: "antigravity", name: "Antigravity", argv: ["agy", "acp"] };
const HOME = "/home/.gemini/antigravity-cli";
const PID = 500;
const COMMAND = "cd /repo && bun test && bin/mono fix";

const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({
	pid,
	ppid,
	pgid: pid,
	tpgid: 0,
	command,
});

/** The transcript step Antigravity writes as it backgrounds `command` into task `n`. */
const backgroundedStep = (session: string, step: number, command: string) =>
	JSON.stringify({
		step_index: step,
		source: "MODEL",
		status: "RUNNING",
		content: [
			"Created At: 2026-11-22T13:32:34-05:00",
			`Tool is running as a background task with task id: ${session}/task-${step}`,
			`Task Description: ${command}`,
			`Task logs are available at: file://${HOME}/brain/${session}/.system_generated/tasks/task-${step}.log`,
			"Log output:",
			"bun test v1.4.4",
		].join("\n"),
	});

const runCommand = (status: "in_progress" | "completed", output?: string) =>
	({
		sessionUpdate: status === "in_progress" ? "tool_call" : "tool_call_update",
		toolCallId: "call_1",
		title: COMMAND,
		kind: "execute",
		status,
		rawInput: { CommandLine: COMMAND, WaitMsBeforeAsync: 1000 },
		...(output === undefined
			? {}
			: {
					content: [
						{ type: "content", content: { type: "text", text: output } },
					],
				}),
	}) as acp.SessionUpdate;
