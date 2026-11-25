import { expect, test } from "bun:test";
import { Duration } from "core/time";
import { FakeClock } from "core/time/testing";
import type { ConversationList } from "../conversations";
import type { Message } from "../conversations/state";
import { EventWaitWatch, eventWaitOf } from "./event-wait-watch";

test("only explicit final agent directives register", () => {
	expect(eventWaitOf(agent("Waiting.\n[SPLATES WAIT task other]"))).toEqual({
		type: "task",
		task: "other",
	});

	expect(
		eventWaitOf({ ...agent("[SPLATES WAIT task other]"), role: "user" }),
	).toBeNull();
	expect(eventWaitOf(agent("[SPLATES WAIT machine idle 2m]"))).toEqual({
		type: "idle",
		duration: Duration.mins(2),
	});
});

test.each([
	"`[SPLATES WAIT task other]`",
	"[SPLATES WAIT task other]\nMore text",
	"[SPLATES WAIT machine idle 0s]",
	"[SPLATES WAIT machine idle 999999999999999999h]",
	"[SPLATES WAIT machine idle -1m]",
])("invalid directive: %s", (text) => {
	expect(eventWaitOf(agent(text))).toBeNull();
});

test("task completion wakes once, including an already completed task after restart", async () => {
	const setup = fixture("[SPLATES WAIT task other]");
	const first = setup.watch();
	await first.sweep();
	expect(setup.said).toEqual([]);
	await first.disposeAsync();
	setup.finish();
	const restarted = setup.watch();
	await restarted.sweep();
	await restarted.sweep();
	expect(setup.said).toEqual(["[SPLATES WAIT COMPLETE]\n\nTask other merged."]);
});

test("task completion wakes an idle-stopped conversation", async () => {
	const setup = fixture("[SPLATES WAIT task other]");
	setup.conversation.state.status = "stopped";
	setup.finish();
	const watch = setup.watch();
	await watch.sweep();
	expect(setup.said).toEqual(["[SPLATES WAIT COMPLETE]\n\nTask other merged."]);
});

test("busy readings reset the continuous idle period", async () => {
	const setup = fixture("[SPLATES WAIT machine idle 10s]");
	const watch = setup.watch();
	await watch.sweep();
	setup.clock.advance(Duration.secs(9));
	setup.reading.cpu = 0.95;
	await watch.sweep();
	setup.reading.cpu = 0.1;
	await watch.sweep();
	setup.clock.advance(Duration.secs(9));
	await watch.sweep();
	expect(setup.said).toEqual([]);
	setup.clock.advance(Duration.secs(1));
	await watch.sweep();
	await watch.sweep();
	expect(setup.said).toHaveLength(1);
});

test.each([
	[
		"archive",
		(state: ReturnType<typeof fixture>["conversation"]["state"]) => {
			state.archived = true;
		},
	],
	[
		"new message",
		(state: ReturnType<typeof fixture>["conversation"]["state"]) => {
			state.messages.push(agent("Finished."));
		},
	],
	[
		"active agent",
		(state: ReturnType<typeof fixture>["conversation"]["state"]) => {
			state.status = "running";
		},
	],
] as const)("%s cancels a wait", async (_, change) => {
	const setup = fixture("[SPLATES WAIT task other]");
	const watch = setup.watch();
	await watch.sweep();
	setup.finish();
	change(setup.conversation.state);
	await watch.sweep();
	expect(setup.said).toEqual([]);
});

test("restart starts a fresh idle observation period", async () => {
	const setup = fixture("[SPLATES WAIT machine idle 10s]");
	const before = setup.watch();
	await before.sweep();
	await before.disposeAsync();
	setup.clock.advance(Duration.secs(20));
	const after = setup.watch();
	await after.sweep();
	expect(setup.said).toEqual([]);
	setup.clock.advance(Duration.secs(10));
	await after.sweep();
	expect(setup.said).toHaveLength(1);
});

test("an unobserved gap does not count as idle time", async () => {
	const setup = fixture("[SPLATES WAIT machine idle 10s]");
	const watch = setup.watch();
	await watch.sweep();
	setup.clock.advance(Duration.mins(5));
	await watch.sweep();
	expect(setup.said).toEqual([]);
	setup.clock.advance(Duration.secs(10));
	await watch.sweep();
	expect(setup.said).toHaveLength(1);
});

test("a newer conversation state during a task check prevents delivery", async () => {
	const setup = fixture("[SPLATES WAIT task other]");
	const watcher = new EventWaitWatch({
		conversations: {
			list: async () => [setup.conversation],
		} as unknown as ConversationList,
		read: async () => setup.reading,
		taskResult: async () => {
			setup.conversation.state = {
				...setup.conversation.state,
				archived: true,
			};
			return "Task other merged.";
		},
		log: { error: () => {} },
	});
	await watcher.sweep();
	expect(setup.said).toEqual([]);
});

test("failed delivery can be retried without losing the request", async () => {
	const setup = fixture("[SPLATES WAIT task other]");
	const delivery = new FailOnceDelivery(setup.said);
	setup.conversation.prompt = (text) => delivery.send(text);
	const watcher = new EventWaitWatch({
		conversations: {
			list: async () => [setup.conversation],
		} as unknown as ConversationList,
		read: async () => setup.reading,
		taskResult: async () => "Task other was removed.",
		log: { error: () => {} },
	});
	await watcher.sweep();
	await watcher.sweep();
	await watcher.sweep();
	expect(delivery.attempts).toBe(2);
	expect(setup.said).toEqual([
		"[SPLATES WAIT COMPLETE]\n\nTask other was removed.",
	]);
});

function agent(text: string): Message {
	return {
		role: "agent",
		parts: [{ type: "text", text }],
		plan: null,
		at: null,
		until: null,
	};
}

function fixture(text: string) {
	const said: string[] = [];
	const clock = new FakeClock();
	const reading = {
		kind: "Mac" as const,
		cpu: 0.1,
		memory: 0.3,
		load: 1,
		cores: 8,
		splates: null,
		temperature: null,
	};
	const conversation = {
		state: {
			id: "c",
			archived: false,
			status: "idle",
			messages: [agent(text)],
		},
		prompt: async (text: string) => {
			said.push(text);
		},
	};
	let result: string | null = null;
	const watch = () =>
		new EventWaitWatch({
			conversations: {
				list: async () => [conversation],
			} as unknown as ConversationList,
			read: async () => reading,
			taskResult: async () => result,
			clock,
			log: {
				error: (message) => {
					throw new Error(message);
				},
			},
		});
	return {
		said,
		clock,
		reading,
		conversation,
		watch,
		finish: () => {
			result = "Task other merged.";
		},
	};
}

class FailOnceDelivery {
	attempts = 0;
	constructor(private readonly said: string[]) {}
	async send(text: string): Promise<void> {
		this.attempts++;
		if (this.attempts === 1) {
			throw new Error("temporarily unavailable");
		}
		this.said.push(text);
	}
}
