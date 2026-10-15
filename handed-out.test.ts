import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer } from "webappwiz/time/testing";
import { add } from "./add";
import { type Conversation, Conversations } from "./conversations";
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
			timer: new FakeTimer(),
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
		await add(deps, "alpha");
	});

	afterEach(async () => {
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
});
