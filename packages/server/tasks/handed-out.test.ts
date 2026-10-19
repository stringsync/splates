import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AGENT, FakeAgent } from "../agents/testing";
import type { LaneRecord, TaskRecord } from "../board";
import { SeenLaneTasks } from "../board";
import {
	type Conversation,
	Conversations,
	SERVER_TOLD,
} from "../conversations";
import { CARRY_ON } from "../plans";
import { Everywhere } from "../projects";
import { Testing } from "../testing";
import { add } from "./add";
import { HandedOut } from "./handed-out";
import { remove } from "./remove";

describe("HandedOut", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let said: string[];
	let conversations: Conversations;
	let watching: HandedOut | null;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	/** Lets the agent's turn on alpha end, which `atWork` holds until then. */
	let release: () => void;
	/** The lanes on the board, lane 1 until a test empties it. */
	let board: LaneRecord[];
	/** The queued tasks on the list, none until a test adds some. */
	let list: TaskRecord[];

	const until = async (done: () => boolean) => {
		for (let i = 0; i < 200 && !done(); i++) {
			await Bun.sleep(10);
		}
	};

	/** Marks a queued task on `list` stuck, as the board does on disk. */
	const stuck = {
		markStuck: async (id: number, at: string | null) => {
			list = list.map((each) => {
				if (each.id !== id) {
					return each;
				}
				const { stuck: _, ...rest } = each;
				return at === null ? rest : { ...rest, stuck: at };
			});
		},
	};

	const open = () =>
		new Conversations(`${deps.splatesDir}/conversations`, [AGENT], {
			launch: agent.launch,
		});

	const watch = () => {
		watching = HandedOut.watch({
			service: deps.service,
			conversations,
			lanes: async () => board,
			queued: async () => list,
			seen: new SeenLaneTasks(deps.fs, `${deps.splatesDir}/lane-tasks.json`),
			stuck,
			log: deps.log,
			timer,
			clock,
		});
		return watching;
	};

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		said = [];
		agent.turn = async (_, __, text) => {
			said.push(text);
			return "end_turn";
		};
		conversations = open();
		watching = null;
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.now());
		release = () => {};
		board = [{ id: 1, name: "Stats" }];
		list = [];
		await add(deps, "alpha");
	});

	afterEach(async () => {
		release();
		watching?.dispose();
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	/** The conversations as the next run of `splates server` reads them back. */
	const restart = async () => {
		await conversations.disposeAsync();
		conversations = open();
	};

	it("tells the one it answers to of an agent a restart stopped mid-task, once", async () => {
		await startedOut();
		await restart();
		const watched = watch();
		await watched.sweep();
		await until(() => said.length === 2);
		await watched.sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES TASK alpha]", "[SPLATES IDLE alpha]"]);
	});

	it("tells one of another project's page, naming the task by its project", async () => {
		const elsewhere = new Conversations(
			`${deps.root}-shop/.git/splates/conversations`,
			[AGENT],
			{ launch: agent.launch },
		);
		try {
			const orchestrator = await elsewhere.start("fake", {
				task: null,
				cwd: `${deps.root}-shop`,
			});
			const working = await conversations.start("fake", {
				task: "alpha",
				cwd: (await deps.service.find("alpha")).path,
				startedBy: orchestrator.id,
			});
			await until(() => working.state.status === "idle");
			await working.prompt("[SPLATES TASK alpha]", [], undefined, {
				told: orchestrator.id,
			});
			await until(() => said.length === 1 && working.state.status === "idle");
			watching = HandedOut.watch({
				service: deps.service,
				conversations,
				everywhere: new Everywhere({
					list: async () => [
						...(await conversations.list()).map((conversation) => ({
							conversation,
							root: deps.root,
						})),
						...(await elsewhere.list()).map((conversation) => ({
							conversation,
							root: `${deps.root}-shop`,
						})),
					],
					slug: async () => "repo",
				}),
				lanes: async () => board,
				queued: async () => list,
				seen: new SeenLaneTasks(deps.fs, `${deps.splatesDir}/lane-tasks.json`),
				stuck,
				log: deps.log,
				timer,
				clock,
			});
			await watching.sweep();
			await until(() => said.length === 2);

			expect(said).toEqual([
				"[SPLATES TASK alpha]",
				"[SPLATES IDLE repo/alpha]",
			]);
		} finally {
			await elsewhere.disposeAsync();
		}
	});

	it("tells it again once the agent has said more and gone quiet again", async () => {
		const { orchestrator, working } = await startedOut();
		const watched = watch();
		await watched.sweep();
		await until(() => said.length === 2);
		await working.prompt("Carry on.", [], undefined, { told: orchestrator.id });
		await until(() => said.length === 4);

		expect(said).toEqual([
			"[SPLATES TASK alpha]",
			"[SPLATES IDLE alpha]",
			"Carry on.",
			"[SPLATES IDLE alpha]",
		]);
	});

	it("tells it nothing of an agent stopped in this run, by a shutdown or the person", async () => {
		const { orchestrator, working } = await startedOut();
		const watched = watch();
		await watched.sweep();
		await until(() => said.length === 2);
		await working.prompt("Carry on.", [], undefined, { told: orchestrator.id });
		await until(() => said.length === 4);
		await working.stop();
		await watched.sweep();
		await Bun.sleep(50);

		expect(said).toHaveLength(4);
	});

	/**
	 * An orchestrator that took a turn, and an agent at work on alpha it
	 * handed out, watched and swept once.
	 */
	const atWork = async (): Promise<{
		orchestrator: Conversation;
		working: Conversation;
		watched: HandedOut;
	}> => {
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		agent.turn = async (_, __, text) => {
			said.push(text);
			if (text === "[SPLATES TASK alpha]") {
				await held;
			}
			return "end_turn";
		};
		const orchestrator = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		await until(() => orchestrator.state.status === "idle");
		await orchestrator.prompt("[SPLATES LANE 1]");
		await until(() => orchestrator.state.status === "idle");
		const working = await conversations.start("fake", {
			task: "alpha",
			cwd: (await deps.service.find("alpha")).path,
			startedBy: orchestrator.id,
		});
		await until(() => working.state.status === "idle");
		void working.prompt("[SPLATES TASK alpha]");
		await until(() => working.state.status === "running");
		const watched = watch();
		await watched.sweep();
		return { orchestrator, working, watched };
	};

	/** A lane's orchestrator, and an agent it started on alpha that took one turn. */
	const startedOut = async (): Promise<{
		orchestrator: Conversation;
		working: Conversation;
	}> => {
		const orchestrator = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		const working = await conversations.start("fake", {
			task: "alpha",
			cwd: (await deps.service.find("alpha")).path,
			startedBy: orchestrator.id,
		});
		await until(() => working.state.status === "idle");
		await working.prompt("[SPLATES TASK alpha]", [], undefined, {
			told: orchestrator.id,
		});
		await until(() => said.length === 1 && working.state.status === "idle");
		return { orchestrator, working };
	};

	it("tells a lane's orchestrator when an agent it started goes quiet on what it said", async () => {
		await startedOut();
		await watch().sweep();
		await until(() => said.length === 2);

		expect(said).toEqual(["[SPLATES TASK alpha]", "[SPLATES IDLE alpha]"]);
	});

	it("tells the orchestrator nothing once the person takes an agent it started in hand", async () => {
		const { working } = await startedOut();
		await working.prompt("Try the other layout.");
		await until(() => said.length === 2 && working.state.status === "idle");
		await watch().sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES TASK alpha]", "Try the other layout."]);
	});

	it("leaves an agent a lane's orchestrator started for the person to archive once its task is gone", async () => {
		const { working } = await startedOut();
		await remove(deps, "alpha", { force: true });
		await watch().sweep();

		expect((await conversations.find(working.id)).state.archived).toBe(false);
	});

	/**
	 * A lane's orchestrator sent lane 1 that answers each prompt with
	 * `reply`, once it has answered the first: `started`, or a new one.
	 */
	const orchestrating = async (
		reply: string,
		started?: Conversation,
	): Promise<Conversation> => {
		agent.turn = async (client, session, text) => {
			said.push(text);
			await client.sessionUpdate({
				sessionId: session,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: reply },
				},
			});
			return "end_turn";
		};
		const orchestrator =
			started ??
			(await conversations.start("fake", {
				task: null,
				cwd: deps.root,
			}));
		await until(() => orchestrator.state.status === "idle");
		await orchestrator.prompt("[SPLATES LANE 1]");
		await until(
			() =>
				orchestrator.state.status === "idle" &&
				orchestrator.state.messages.at(-1)?.role === "agent",
		);
		return orchestrator;
	};

	it("tells an orchestrator still saying its lanes are under way once they are done, once", async () => {
		await orchestrating(
			"## ⏳ Working lanes Stats: on beta\n\n#### #2 went out.",
		);
		board = [];
		const watched = watch();
		await watched.sweep();
		await until(() => said.length === 2);
		await watched.sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES LANE 1]", "[SPLATES LANES DONE]"]);
	});

	it("tells an orchestrator nothing while one of its lanes is left", async () => {
		await orchestrating(
			"## ⏳ Working lanes Stats: on beta\n\n#### #2 went out.",
		);
		await watch().sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES LANE 1]"]);
	});

	it("tells an orchestrator nothing once it has said its lanes are finished", async () => {
		await orchestrating("## 🏁 Finished lanes Stats\n\nThe Stats page leads.");
		board = [];
		await watch().sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES LANE 1]"]);
	});

	it("archives an orchestrator whose turn ends on its Finished report", async () => {
		watch();
		const orchestrator = await orchestrating(
			"## 🏁 Finished lanes Stats\n\nThe Stats page leads.",
		);
		await until(() => orchestrator.state.archived);

		expect(orchestrator.state.archived).toBe(true);
	});

	it("archives the agents an orchestrator started along with it once their tasks are gone", async () => {
		const { orchestrator, working } = await startedOut();
		working.move(null, deps.root);
		watch();
		await orchestrating(
			"## 🏁 Finished lanes Stats\n\nThe Stats page leads.",
			orchestrator,
		);
		await until(() => orchestrator.state.archived);

		expect(working.state.archived).toBe(true);
		expect(working.state.archivedWith).toBe(orchestrator.id);
	});

	it("leaves a finished orchestrator to the person while an agent it started holds its task", async () => {
		const { orchestrator } = await startedOut();
		watch();
		await orchestrating(
			"## 🏁 Finished lanes Stats\n\nThe Stats page leads.",
			orchestrator,
		);
		await Bun.sleep(50);

		expect(orchestrator.state.archived).toBe(false);
	});

	it("archives no orchestrator whose turn ends with its lanes under way", async () => {
		watch();
		const orchestrator = await orchestrating(
			"## ⏳ Working lanes Stats: on beta\n\n#### #2 went out.",
		);
		await Bun.sleep(50);

		expect(orchestrator.state.archived).toBe(false);
	});

	it("tells an orchestrator whose lanes were done while splates server was down", async () => {
		await orchestrating(
			"## ⏳ Working lanes Stats: on beta\n\n#### #2 went out.",
		);
		board = [];
		await restart();
		await watch().sweep();
		await until(() => said.length === 2);

		expect(said).toEqual(["[SPLATES LANE 1]", "[SPLATES LANES DONE]"]);
	});

	/** Task `id` in `lane`, taken by `takenBy`. */
	const queued = (
		id: number,
		takenBy: string | null,
		lane: number | null = 1,
	): TaskRecord => ({
		id,
		subject: `queued task ${id}`,
		text: "",
		position: id,
		from: null,
		createdAt: "2026-10-16T00:00:00Z",
		takenBy,
		files: [],
		blockedBy: [],
		lane,
		stage: "backlog",
	});

	it("tells an orchestrator once as a queued task in its lane leaves the list", async () => {
		await orchestrating(
			"## ⏳ Working lanes Stats: on beta\n\n#### #2 went out.",
		);
		list = [queued(2, "beta"), queued(3, null)];
		const watched = watch();
		await watched.sweep();
		list = [queued(3, null)];
		await watched.sweep();
		await until(() => said.length === 2);
		await watched.sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES LANE 1]", "[SPLATES TASK DONE #2]"]);
	});

	it("tells an orchestrator as a queued task in its lane comes back open", async () => {
		await orchestrating(
			"## ⏳ Working lanes Stats: on beta\n\n#### #2 went out.",
		);
		list = [queued(2, "beta")];
		const watched = watch();
		await watched.sweep();
		list = [queued(2, null)];
		await watched.sweep();
		await until(() => said.length === 2);

		expect(said).toEqual(["[SPLATES LANE 1]", "[SPLATES TASK OPEN #2]"]);
	});

	it("tells an orchestrator nothing of a queued task in a lane it does not work", async () => {
		await orchestrating(
			"## ⏳ Working lanes Stats: on beta\n\n#### #2 went out.",
		);
		board = [
			{ id: 1, name: "Stats" },
			{ id: 2, name: "Licensing" },
		];
		list = [queued(2, "beta", 2)];
		const watched = watch();
		await watched.sweep();
		list = [];
		await watched.sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES LANE 1]"]);
	});

	it("tells an orchestrator of a queued task that left its lane while splates server was down", async () => {
		await orchestrating(
			"## ⏳ Working lanes Stats: on beta\n\n#### #2 went out.",
		);
		list = [queued(2, "beta"), queued(3, null)];
		await watch().sweep();
		watching?.dispose();
		list = [queued(3, null)];
		await restart();
		await watch().sweep();
		await until(() => said.length === 2);

		expect(said).toEqual(["[SPLATES LANE 1]", "[SPLATES TASK DONE #2]"]);
	});

	/** Lane 1 set running, by the person; alpha holds its queued task 2. */
	const running = () => {
		board = [{ id: 1, name: "Stats", running: { by: null } }];
		list = [queued(2, "alpha")];
	};

	it("tells the agent of a running lane's task to carry on itself, and its orchestrator only once it stops again", async () => {
		running();
		const { working } = await startedOut();
		await watch().sweep();
		await until(() => said.length === 3);

		expect(said).toEqual([
			"[SPLATES TASK alpha]",
			CARRY_ON,
			"[SPLATES IDLE alpha]",
		]);
		expect(
			working.state.messages.findLast((message) => message.role === "user")
				?.told,
		).toBe(SERVER_TOLD);
		expect(list[0]?.stuck).toBe(new Date(clock.now()).toISOString());
	});

	it("marks the queued task of a running lane the person set going stuck, telling no one", async () => {
		running();
		const working = await conversations.start("fake", {
			task: "alpha",
			cwd: (await deps.service.find("alpha")).path,
		});
		await until(() => working.state.status === "idle");
		await working.prompt("[SPLATES TASK alpha]", [], undefined, {
			told: SERVER_TOLD,
		});
		await until(() => said.length === 1 && working.state.status === "idle");
		await watch().sweep();
		await until(() => list[0]?.stuck !== undefined);
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES TASK alpha]", CARRY_ON]);
	});

	it("leaves a running lane's agent the person took in hand to them", async () => {
		running();
		const { working } = await startedOut();
		await working.prompt("Try the other layout.");
		await until(() => said.length === 2 && working.state.status === "idle");
		await watch().sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES TASK alpha]", "Try the other layout."]);
		expect(list[0]?.stuck).toBeUndefined();
	});

	it("marks a stuck queued task no longer stuck once its agent is at work again", async () => {
		running();
		list = [{ ...queued(2, "alpha"), stuck: "2026-10-16T00:00:00Z" }];
		const { watched } = await atWork();
		await watched.sweep();

		expect(list[0]?.stuck).toBeUndefined();
	});

	it("tells an orchestrator of a running lane of a queued task come into it, not of one done or open", async () => {
		await orchestrating(
			"## ⏳ Working lanes Stats: running\n\n#### The lane runs.",
		);
		board = [{ id: 1, name: "Stats", running: { by: null } }];
		list = [queued(2, "beta"), queued(3, "gamma")];
		const watched = watch();
		await watched.sweep();
		list = [queued(3, null), queued(4, null)];
		await watched.sweep();
		await until(() => said.length === 2);
		await watched.sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[SPLATES LANE 1]", "[SPLATES TASK ADDED #4]"]);
	});
});
