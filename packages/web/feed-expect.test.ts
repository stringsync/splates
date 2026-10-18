import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Snapshot } from "@stringsync/splates-server/snapshot";
import { Feed } from "./feed";
import { snapshot, todo } from "./testing";

describe("Feed's expect", () => {
	const fetched = globalThis.fetch;
	const Source = globalThis.EventSource;
	/** The stream the feed opened, to say what the server would. */
	let stream: { onmessage: (() => void) | null } | null;
	/** What the server reads the repo as, for the next snapshot read. */
	let served: Snapshot;
	/** Each snapshot read on its way, answered by `answer`. */
	let reads: (() => void)[];
	let feed: Feed;

	beforeEach(async () => {
		stream = null;
		served = snapshot({ todos: [todo({ subject: "Old" })] });
		reads = [];
		globalThis.fetch = (async () => {
			// What the server read as it was asked, answered when the test says.
			const read = served;
			await new Promise<void>((resolve) => reads.push(resolve));
			return Response.json(read);
		}) as unknown as typeof fetch;
		globalThis.EventSource = class {
			onmessage = null;
			onopen = null;
			onerror = null;
			constructor() {
				stream = this;
			}
			addEventListener(): void {}
			close(): void {}
		} as unknown as typeof EventSource;
		feed = new Feed();
		feed.start();
		await answer();
	});

	afterEach(() => {
		feed.dispose();
		globalThis.fetch = fetched;
		globalThis.EventSource = Source;
	});

	/** Lets the reads on their way answer, and waits for the feed to take them in. */
	async function answer(): Promise<void> {
		for (let turn = 0; turn < 20; turn++) {
			for (const read of reads.splice(0)) {
				read();
			}
			await Bun.sleep(0);
		}
	}

	/** Says the repo moved, as the server's push does, starting a read. */
	function push(): void {
		stream?.onmessage?.();
	}

	/** A write the test answers, as the server would. */
	function write(): {
		done: Promise<void>;
		land: () => void;
		refuse: (why: string) => void;
	} {
		let land = () => {};
		let refuse = (_why: string) => {};
		const done = new Promise<void>((resolve, reject) => {
			land = resolve;
			refuse = (why) => reject(new Error(why));
		});
		return { done, land, refuse };
	}

	const renamed =
		(subject: string) =>
		(shown: Snapshot): Snapshot => ({
			...shown,
			todos: shown.todos.map((each) => ({ ...each, subject })),
		});

	const subject = () => feed.snapshot?.todos[0]?.subject;

	it("shows an expected change at once, over what is read meanwhile, until a read after it lands", async () => {
		const rename = write();

		const shown = feed.expect(renamed("New"), rename.done);
		expect(subject()).toBe("New");
		served = snapshot({ todos: [todo({ subject: "Old", position: 2 })] });
		push();
		await answer();
		expect(feed.snapshot?.todos[0]).toMatchObject({
			subject: "New",
			position: 2,
		});

		rename.land();
		await shown;
		expect(subject()).toBe("New");
		served = snapshot({ todos: [todo({ subject: "Server's" })] });
		push();
		await answer();
		expect(subject()).toBe("Server's");
	});

	it("keeps it past a read that began before the write landed", async () => {
		const rename = write();
		const shown = feed.expect(renamed("New"), rename.done);

		push();
		rename.land();
		await shown;
		await answer();

		expect(subject()).toBe("New");
	});

	it("drops it at its answer when the server's snapshot already holds it", async () => {
		served = snapshot({ todos: [todo({ subject: "New" })] });
		push();
		await answer();
		const rename = write();
		const shown = feed.expect(renamed("New"), rename.done);

		rename.land();
		await shown;
		served = snapshot({ todos: [todo({ subject: "Later" })] });
		push();
		push();
		await answer();

		expect(subject()).toBe("Later");
	});

	it("drops a refused change at once and rejects with why", async () => {
		const rename = write();
		const shown = feed.expect(renamed("New"), rename.done);

		rename.refuse("no such todo");

		await expect(shown).rejects.toThrow("no such todo");
		expect(subject()).toBe("Old");
	});

	it("shows changes in the order made, each over the last", async () => {
		const first = write();
		const second = write();

		void feed.expect(renamed("First"), first.done);
		const refused = feed.expect(renamed("Second"), second.done);
		expect(subject()).toBe("Second");

		second.refuse("no");
		await expect(refused).rejects.toThrow("no");
		expect(subject()).toBe("First");
	});
});
