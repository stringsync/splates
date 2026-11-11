import { beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer } from "core/time/testing";
import type { Entry } from "./entry";
import type { ConversationDeps, ConversationHost } from "./host";
import { applyProgress, ConversationProgress } from "./progress";
import type { Background, Progress } from "./state";

describe("ConversationProgress", () => {
	let timer: FakeTimer;
	let progress: ConversationProgress;
	let state: { progress: Progress[]; background: Background[] };
	let written: Entry[];
	let changes: number;
	let tick: number;

	beforeEach(() => {
		timer = new FakeTimer();
		state = { progress: [], background: [] };
		written = [];
		changes = 0;
		tick = 0;
		const host = {
			state,
			log: { write: (entry: Entry) => written.push(entry) },
			now: () => `t${tick++}`,
			changed: () => {
				changes++;
				progress.settle();
			},
		} as unknown as ConversationHost;
		progress = new ConversationProgress(host, {
			timer,
		} as unknown as ConversationDeps);
	});

	it("publishes the first update at once", () => {
		progress.report({ id: "build", title: "Build", note: "starting" });

		expect(state.progress).toHaveLength(1);
		expect(state.progress[0]).toMatchObject({
			id: "build",
			title: "Build",
			state: "running",
			note: "starting",
			percent: null,
		});
		expect(changes).toBe(1);
	});

	it("shows a burst of a thousand lines as its first and its last", () => {
		Array.from({ length: 1000 }, (_, line) =>
			progress.report({ id: "build", note: `line ${line}` }),
		);
		expect(written).toHaveLength(1);
		expect(changes).toBe(1);

		timer.fireTimeouts();

		expect(written).toHaveLength(2);
		expect(changes).toBe(2);
		expect(state.progress[0]?.note).toBe("line 999");
		// The page never saw the 998 between, and neither did the history.
		expect(state.progress[0]?.history.map((each) => each.note)).toEqual([
			"line 0",
		]);
	});

	it("answers a held update with the card as it will show", () => {
		progress.report({ id: "build", note: "one" });
		const held = progress.report({ id: "build", percent: 40 });

		expect(held).toMatchObject({ note: "one", percent: 40 });
		expect(state.progress[0]?.percent).toBeNull();
	});

	it("drops an update that changes nothing the page shows", () => {
		progress.report({ id: "build", note: "same", percent: 10 });
		progress.report({ id: "build", note: "same", percent: 10 });
		progress.report({ id: "build", note: "  same \n", percent: 10 });

		timer.fireTimeouts();

		expect(written).toHaveLength(1);
	});

	it("publishes a finish at once, with what was held before it", () => {
		progress.report({ id: "build", note: "one" });
		progress.report({ id: "build", note: "two" });
		progress.report({ id: "build", state: "done" });

		expect(state.progress[0]).toMatchObject({
			state: "done",
			percent: 100,
			note: "two",
		});
		// The timer held for the burst has nothing left to publish.
		timer.fireTimeouts();
		expect(written).toHaveLength(2);
	});

	it("keeps each card on its own gap", () => {
		progress.report({ id: "a", note: "1" });
		progress.report({ id: "b", note: "1" });

		expect(state.progress.map((each) => each.id)).toEqual(["a", "b"]);
	});

	it("folds whitespace, cuts long notes and clamps percent", () => {
		progress.report({
			id: "build",
			note: `a\n\n  b ${"x".repeat(500)}`,
			percent: 250,
		});

		const [card] = state.progress;
		expect(card?.note.startsWith("a b x")).toBe(true);
		expect(card?.note.length).toBeLessThanOrEqual(200);
		expect(card?.percent).toBe(100);
	});

	it("keeps the last twenty notes", () => {
		Array.from({ length: 40 }, (_, step) => {
			progress.report({ id: "build", note: `step ${step}` });
			return timer.fireTimeouts();
		});

		expect(state.progress[0]?.history).toHaveLength(20);
		expect(state.progress[0]?.history.at(-1)?.note).toBe("step 38");
	});

	it("finishes a card whose background command ended", () => {
		progress.report({ id: "task-1", title: "Import" });
		state.background.push({
			id: "task-1",
			name: "Import",
			command: null,
			subagent: null,
			state: "failed",
			output: null,
		});

		progress.settle();

		expect(state.progress[0]?.state).toBe("failed");
	});

	it("drops the oldest finished card past ten", () => {
		const list: Progress[] = [];
		const card = (id: string, done: boolean): Progress => ({
			id,
			title: id,
			state: done ? "done" : "running",
			percent: null,
			note: "",
			startedAt: "",
			updatedAt: "",
			history: [],
		});
		applyProgress(list, card("old", false));
		applyProgress(list, card("finished", true));
		Array.from({ length: 9 }, (_, each) =>
			applyProgress(list, card(`more-${each}`, false)),
		);

		expect(list).toHaveLength(10);
		expect(list.map((each) => each.id)).not.toContain("finished");
		expect(list[0]?.id).toBe("old");
	});

	it("stops running cards when its agent's process ends, dropping what waited", () => {
		progress.report({ id: "build", note: "one" });
		progress.report({ id: "build", note: "two" });
		progress.report({ id: "lint", state: "done" });

		progress.end();
		timer.fireTimeouts();

		expect(state.progress.map((each) => [each.id, each.state])).toEqual([
			["build", "stopped"],
			["lint", "done"],
		]);
		expect(state.progress[0]?.note).toBe("one");
	});

	it("clears every card when archived, and nothing publishes after", () => {
		progress.report({ id: "build", note: "one" });
		progress.report({ id: "build", note: "two" });

		progress.clear();
		timer.fireTimeouts();

		expect(state.progress).toEqual([]);
		expect(written).toHaveLength(1);
	});

	it("stops its timers when disposed", () => {
		progress.report({ id: "build", note: "one" });
		progress.report({ id: "build", note: "two" });
		progress.dispose();

		timer.fireTimeouts();

		expect(written).toHaveLength(1);
	});
});
