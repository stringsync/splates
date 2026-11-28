import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import type { ProcessEntry } from "core/system";
import { FakeFs, FakePs } from "core/system/testing";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import { backgroundStarted, FakeAgent } from "../agents/testing";
import { LocalWorkerMachine } from "../workers";
import { type ConversationState, Conversations } from "./index";
import { CHECK_EVERY, named } from "./left-running";
import { eventually, until } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };
const PID = 500;

/** A process, `pid` under `ppid`, running `command`. */
const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({
	pid,
	ppid,
	pgid: pid,
	tpgid: 0,
	command,
});

describe("What an agent left running", () => {
	let fs: FakeFs;
	let ps: FakePs;
	let timer: FakeTimer;
	let agent: FakeAgent;
	let table: ProcessEntry[];
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		for (const tree of ["/repo", "/repo-splates/login"]) {
			await fs.mkdir(tree);
		}
		ps = new FakePs();
		timer = new FakeTimer();
		agent = new FakeAgent();
		agent.pid = PID;
		// The agent, and the MCP server it opened its session with.
		table = [entry(PID, 1, "fake-acp"), entry(501, PID, "node playwright")];
		ps.setProcesses(table);
		const machine = new LocalWorkerMachine(ps, fs);
		conversations = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock: new FakeWallClock(Date.parse("2026-11-18T10:00:00Z")),
				ids: new CounterIdProvider(),
				launch: agent.launch,
				machine,
			},
		);
	});

	afterEach(() => conversations.disposeAsync());

	/** A conversation whose next turn starts `left` and leaves them running. */
	const turnLeaving = async (...left: ProcessEntry[]) => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		agent.turn = async () => {
			table.push(...left);
			ps.setProcesses(table);
			return "end_turn";
		};
		await conversation.prompt("serve it");
		await until(conversation, "idle");
		return conversation;
	};

	const listed = (state: ConversationState) =>
		state.background.map(({ id, name, state, pid }) => ({
			id,
			name,
			state,
			pid,
		}));

	/** Fires the check for processes that ended. */
	const check = () => {
		for (const [index, each] of timer.timeouts.entries()) {
			if (each.delay.isEqual(CHECK_EVERY)) {
				timer.fireTimeout(index);
			}
		}
	};

	it("lists what a turn left running, once, by its command, without what ran before it", async () => {
		const conversation = await turnLeaving(
			entry(600, PID, "/bin/zsh -c bun dev"),
			entry(601, 600, "bun run vite"),
		);

		await eventually(() => conversation.state.background.length > 0);
		expect(listed(conversation.state)).toEqual([
			{ id: "pid:600", name: "bun dev", state: "running", pid: 600 },
		]);
		expect(conversation.state.background[0]).toMatchObject({
			command: "/bin/zsh -c bun dev",
		});
		expect(conversation.state.background[0]?.canStop).toBeUndefined();
	});

	it("says one ended once it is gone from the table", async () => {
		const conversation = await turnLeaving(entry(600, PID, "sleep 60"));
		await eventually(() => conversation.state.background.length > 0);

		table = table.filter((each) => each.pid !== 600);
		ps.setProcesses(table);
		check();

		await eventually(
			() => conversation.state.background[0]?.state === "completed",
		);
		expect(listed(conversation.state)).toEqual([
			{ id: "pid:600", name: "sleep 60", state: "completed", pid: 600 },
		]);
	});

	it("leaves out an MCP server started on first use, and caffeinate", async () => {
		const conversation = await turnLeaving(
			entry(600, PID, "npx @playwright/mcp@latest"),
			entry(601, PID, "caffeinate -i -t 300"),
		);
		// Let the turn's end be looked at before saying it found nothing.
		await Bun.sleep(5);

		expect(conversation.state.background).toEqual([]);
	});

	it("leaves out an exited process ps still shows as (name)", async () => {
		const conversation = await turnLeaving(entry(600, PID, "(git)"));
		await Bun.sleep(5);

		expect(conversation.state.background).toEqual([]);
	});

	it("leaves out a command the agent already said it left in the background", async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "t-b1",
					title: "bun dev",
					kind: "execute",
					status: "completed",
					rawInput: { command: "bun dev", run_in_background: true },
				},
			});
			await client.sessionUpdate({
				sessionId,
				update: backgroundStarted("b1", "Run bun dev", "t-b1"),
			});
			table.push(
				entry(600, PID, "/bin/zsh -c source snap.sh && eval 'bun dev'"),
			);
			ps.setProcesses(table);
			return "end_turn";
		};

		await conversation.prompt("serve it");
		await until(conversation, "idle");
		await Bun.sleep(5);

		expect(conversation.state.background.map(({ id }) => id)).toEqual(["b1"]);
	});

	it("stops one by terminating its process tree on the worker", async () => {
		const conversation = await turnLeaving(
			entry(600, PID, "/bin/zsh -c bun dev"),
			entry(601, 600, "bun run vite"),
		);
		await eventually(() => conversation.state.background.length > 0);

		await conversation.stopBackground("pid:600");

		expect(ps.getCalls()).toEqual(["kill -TERM 600 601"]);
		expect(agent.stoppedBackground).toEqual([]);
		expect(listed(conversation.state)).toEqual([
			{ id: "pid:600", name: "bun dev", state: "stopped", pid: 600 },
		]);
	});

	it("names a command by what the shell runs", () => {
		expect(
			named(
				"/bin/zsh -c -l source /tmp/snap.sh && setopt NO_EXTENDED_GLOB && eval 'bun test --watch' < /dev/null",
			),
		).toBe("bun test --watch");
		expect(named("python3 -m http.server")).toBe("python3 -m http.server");
	});
});
