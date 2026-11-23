import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeAgent, say } from "../agents/testing";
import { Conversations } from "../conversations";
import { Testing } from "../testing";
import { type ShipFixBoard, ShipFixFollowUp } from "./ship-fix-follow-up";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

class FakeShipFixBoard implements ShipFixBoard {
	taken = new Set<number>();
	abandonedCalls: Array<{ task: number; note: string | undefined }> = [];

	async untaken(task: number): Promise<boolean> {
		return !this.taken.has(task);
	}

	async abandoned(task: number, note: string | undefined): Promise<void> {
		this.abandonedCalls.push({ task, note });
	}
}

describe("ShipFixFollowUp", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let board: FakeShipFixBoard;
	let followUp: ShipFixFollowUp;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		conversations = new Conversations(`${deps.dir}/conversations`, [AGENT], {
			storage: deps.storage.within("conversations"),
			launch: agent.launch,
		});
		board = new FakeShipFixBoard();
		followUp = new ShipFixFollowUp(board);
	});

	afterEach(async () => {
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("waits for the first turn to finish before checking untaken, sending no nudge when taken during the turn", async () => {
		const told: string[] = [];
		let releaseTurn: (() => void) | undefined;
		const turnStarted = new Promise<void>((resolve) => {
			agent.turn = async (_, __, text) => {
				told.push(text);
				resolve();
				await new Promise<void>((done) => {
					releaseTurn = done;
				});
				board.taken.add(42);
				return "end_turn";
			};
		});

		const conversation = await conversations.start(AGENT.id, {
			task: null,
			cwd: deps.service.git.root,
		});
		const running = followUp.run(conversation, 42);
		await turnStarted;
		await Bun.sleep(20);

		expect(told).toHaveLength(1);
		expect(board.abandonedCalls).toEqual([]);

		releaseTurn?.();
		await running;

		expect(told).toHaveLength(1);
		expect(board.abandonedCalls).toEqual([]);
	});

	it("nudges once after an untaken turn ends and does not abandon when the nudge turn takes the task", async () => {
		const told: string[] = [];
		const actions = [() => {}, () => board.taken.add(42)];
		agent.turn = async (_, __, text) => {
			told.push(text);
			actions.shift()?.();
			return "end_turn";
		};

		const conversation = await conversations.start(AGENT.id, {
			task: null,
			cwd: deps.service.git.root,
		});
		await followUp.run(conversation, 42);

		expect(told).toHaveLength(2);
		expect(told[1]).toContain("Your turn ended and task #42 is still untaken");
		expect(board.abandonedCalls).toEqual([]);
	});

	it("marks the task abandoned with the agent's last reply only after the nudge turn also ends untaken", async () => {
		const told: string[] = [];
		const replies = ["", "Ship a version to staging first, then Retry."];
		agent.turn = async (client, sessionId, text) => {
			told.push(text);
			await client.sessionUpdate({
				sessionId,
				update: say(replies.shift() ?? ""),
			});
			return "end_turn";
		};

		const conversation = await conversations.start(AGENT.id, {
			task: null,
			cwd: deps.service.git.root,
		});
		await followUp.run(conversation, 42);

		expect(told).toHaveLength(2);
		expect(board.abandonedCalls).toEqual([
			{ task: 42, note: "Ship a version to staging first, then Retry." },
		]);
	});

	it("stops without nudging or abandoning when the conversation is stopped mid-turn", async () => {
		const told: string[] = [];
		const turnStarted = new Promise<void>((resolve) => {
			agent.turn = async (_, __, text) => {
				told.push(text);
				resolve();
				await new Promise<void>(() => {});
				return "end_turn";
			};
		});

		const conversation = await conversations.start(AGENT.id, {
			task: null,
			cwd: deps.service.git.root,
		});
		const running = followUp.run(conversation, 42);
		await turnStarted;
		await conversation.stop();
		await running;

		expect(told).toHaveLength(1);
		expect(board.abandonedCalls).toEqual([]);
	});
});
