import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { add } from "./add";
import { HEARTBEAT_IDLE } from "./conversation-state";
import { type Conversation, Conversations } from "./conversations";
import { Everywhere } from "./everywhere";
import { AGENT, FakeAgent } from "./fake-agent";
import { HandedOut } from "./handed-out";
import { remove } from "./remove";
import { Testing } from "./testing";

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

	const until = async (done: () => boolean) => {
		for (let i = 0; i < 200 && !done(); i++) {
			await Bun.sleep(10);
		}
	};

	const open = () =>
		new Conversations(`${deps.arborDir}/conversations`, [AGENT], {
			launch: agent.launch,
		});

	const watch = () => {
		watching = HandedOut.watch({
			service: deps.service,
			conversations,
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
		await add(deps, "alpha");
	});

	afterEach(async () => {
		release();
		watching?.dispose();
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	/** An orchestrator, and an agent it handed alpha to that took one turn. */
	const handedOut = async (): Promise<{
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
			handedBy: orchestrator.id,
		});
		await until(() => working.state.status === "idle");
		await working.prompt("[ARBOR TASK alpha]");
		await until(() => said.length === 1 && working.state.status === "idle");
		return { orchestrator, working };
	};

	/** The conversations as the next run of `arbor dev` reads them back. */
	const restart = async () => {
		await conversations.disposeAsync();
		conversations = open();
	};

	it("tells the one it answers to of an agent a restart stopped mid-task, once", async () => {
		await handedOut();
		await restart();
		const watched = watch();
		await watched.sweep();
		await until(() => said.length === 2);
		await watched.sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[ARBOR TASK alpha]", "[ARBOR IDLE alpha]"]);
	});

	it("tells one of another project's page, naming the task by its project", async () => {
		const elsewhere = new Conversations(
			`${deps.root}-shop/.git/arbor/conversations`,
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
				handedBy: orchestrator.id,
			});
			await until(() => working.state.status === "idle");
			await working.prompt("[ARBOR TASK alpha]");
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
				log: deps.log,
				timer,
				clock,
			});
			await watching.sweep();
			await until(() => said.length === 2);

			expect(said).toEqual(["[ARBOR TASK alpha]", "[ARBOR IDLE repo/alpha]"]);
		} finally {
			await elsewhere.disposeAsync();
		}
	});

	it("tells it again once the agent has said more and gone quiet again", async () => {
		const { working } = await handedOut();
		const watched = watch();
		await watched.sweep();
		await until(() => said.length === 2);
		await working.prompt("Carry on.");
		await until(() => said.length === 4);

		expect(said).toEqual([
			"[ARBOR TASK alpha]",
			"[ARBOR IDLE alpha]",
			"Carry on.",
			"[ARBOR IDLE alpha]",
		]);
	});

	it("tells it nothing of an agent stopped in this run, by a shutdown or the person", async () => {
		const { working } = await handedOut();
		const watched = watch();
		await watched.sweep();
		await until(() => said.length === 2);
		await working.prompt("Carry on.");
		await until(() => said.length === 4);
		await working.stop();
		await watched.sweep();
		await Bun.sleep(50);

		expect(said).toHaveLength(4);
	});

	it("archives an agent whose task went while arbor dev was down", async () => {
		const { orchestrator, working } = await handedOut();
		await restart();
		await remove(deps, "alpha", { force: true });
		await watch().sweep();
		const read = await conversations.find(working.id);

		expect(said).toEqual(["[ARBOR TASK alpha]"]);
		expect(read.state).toMatchObject({
			archived: true,
			archivedWith: orchestrator.id,
		});
	});

	/**
	 * An orchestrator that took a turn, and an agent at work on alpha it
	 * handed out, watched and swept once.
	 */
	const atWork = async (
		/** How the agent stands to the orchestrator. */
		as: "handedBy" | "startedBy" = "handedBy",
	): Promise<{
		orchestrator: Conversation;
		working: Conversation;
		watched: HandedOut;
	}> => {
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		agent.turn = async (_, __, text) => {
			said.push(text);
			if (text === "[ARBOR TASK alpha]") {
				await held;
			}
			return "end_turn";
		};
		const orchestrator = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		await until(() => orchestrator.state.status === "idle");
		await orchestrator.prompt("[ARBOR LANE 1]");
		await until(() => orchestrator.state.status === "idle");
		const working = await conversations.start("fake", {
			task: "alpha",
			cwd: (await deps.service.find("alpha")).path,
			[as]: orchestrator.id,
		});
		await until(() => working.state.status === "idle");
		void working.prompt("[ARBOR TASK alpha]");
		await until(() => working.state.status === "running");
		const watched = watch();
		await watched.sweep();
		return { orchestrator, working, watched };
	};

	/** When the orchestrator's last turn ended, plus `HEARTBEAT_IDLE`. */
	const due = (orchestrator: Conversation): string => {
		const last = orchestrator.state.messages.at(-1);
		return new Date(
			Date.parse(last?.until ?? "") + HEARTBEAT_IDLE.ms,
		).toISOString();
	};

	/** Fires the heartbeat's timeout, leaving the settling debounce be. */
	const fire = () => {
		for (const each of timer.timeouts.filter(
			(entry) => entry.delay.ms > Duration.mins(1).ms,
		)) {
			if (!each.disposed) {
				each.callback();
			}
		}
	};

	it("sends a heartbeat to an idle orchestrator to check on its agents once its last turn is HEARTBEAT_IDLE behind", async () => {
		const { orchestrator } = await atWork();

		expect(orchestrator.state.heartbeat).toBe(due(orchestrator));

		clock.set(Date.parse(due(orchestrator)));
		fire();
		await until(() => said.includes("[ARBOR HEARTBEAT]"));

		expect(said).toEqual([
			"[ARBOR LANE 1]",
			"[ARBOR TASK alpha]",
			"[ARBOR HEARTBEAT]",
		]);
	});

	it("puts the heartbeat off when the orchestrator takes a turn first", async () => {
		const { orchestrator, watched } = await atWork();
		const first = orchestrator.state.heartbeat;
		await Bun.sleep(5);
		await orchestrator.prompt("Where do the lanes stand?");
		await until(() => orchestrator.state.status === "idle");
		await watched.sweep();

		expect(orchestrator.state.heartbeat).toBe(due(orchestrator));
		expect(Date.parse(orchestrator.state.heartbeat ?? "")).toBeGreaterThan(
			Date.parse(first ?? ""),
		);

		clock.set(Date.parse(first ?? ""));
		fire();
		await Bun.sleep(50);

		expect(said).not.toContain("[ARBOR HEARTBEAT]");
	});

	it("has no heartbeat due once no agent it handed a task to is at work", async () => {
		const { orchestrator, working, watched } = await atWork();
		release();
		await until(() => working.state.status === "idle");
		await watched.sweep();

		expect(orchestrator.state.heartbeat).toBeNull();
	});
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
		await working.prompt("[ARBOR TASK alpha]", [], undefined, {
			told: orchestrator.id,
		});
		await until(() => said.length === 1 && working.state.status === "idle");
		return { orchestrator, working };
	};

	it("tells a lane's orchestrator when an agent it started goes quiet on what it said", async () => {
		await startedOut();
		await watch().sweep();
		await until(() => said.length === 2);

		expect(said).toEqual(["[ARBOR TASK alpha]", "[ARBOR IDLE alpha]"]);
	});

	it("tells the orchestrator nothing once the person takes an agent it started in hand", async () => {
		const { working } = await startedOut();
		await working.prompt("Try the other layout.");
		await until(() => said.length === 2 && working.state.status === "idle");
		await watch().sweep();
		await Bun.sleep(50);

		expect(said).toEqual(["[ARBOR TASK alpha]", "Try the other layout."]);
	});

	it("leaves an agent a lane's orchestrator started for the person to archive once its task is gone", async () => {
		const { working } = await startedOut();
		await remove(deps, "alpha", { force: true });
		await watch().sweep();

		expect((await conversations.find(working.id)).state.archived).toBe(false);
	});

	it("sends no heartbeat to a lane's orchestrator, whose agents talk to the person", async () => {
		const { orchestrator } = await atWork("startedBy");

		expect(orchestrator.state.heartbeat).toBeNull();
	});
});
