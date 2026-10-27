import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { type JSX, Profiler } from "react";
import { ConversationFeed } from "./conversation-feed";
import {
	conversationIndex,
	useConversation,
	useConversationIndex,
} from "./conversation-index";
import { ConversationList } from "./conversation-list";
import { Conversations } from "./conversations";
import { DispatchingProvider } from "./dispatching";
import { Drafts } from "./drafts";
import { Talking } from "./expecting";
import { useHeldConversations } from "./handed-out";
import { ShortcutSettings } from "./hooks/use-shortcut";
import { Settings } from "./settings";
import { Terminals } from "./terminals";
import {
	act,
	cleanup,
	conversation,
	message,
	render,
	Testing,
} from "./testing";

describe("conversation render subscriptions", () => {
	let testing: Testing;
	let feed: ConversationFeed;
	let one: ConversationState;
	let drafts: Drafts;
	let terminals: Terminals;
	let settings: Settings;
	beforeEach(() => {
		testing = new Testing();
		feed = new ConversationFeed(testing.timer, testing.wall);
		one = conversation({
			id: "one",
			title: "One",
			status: "running",
			messages: [message("user", "Do the work"), message("agent", "First")],
		});
		feed.put(
			conversation({
				id: "two",
				title: "Two",
				messages: [message("agent", "Second")],
			}),
		);
		feed.available = true;
		feed.put(one);
		drafts = new Drafts(localStorage, null);
		terminals = new Terminals(localStorage, () => false, {
			timer: testing.timer,
		});
		settings = new Settings(localStorage);
	});
	afterEach(() => {
		cleanup();
		terminals.dispose();
		feed.dispose();
		testing.dispose();
	});

	// scry-ignore simple-test-setup: the baseline and streamed states are the behavior this case compares; the shared feed is in beforeEach
	it("keeps streaming words and usage out of the list, while preserving state and report changes", () => {
		const original = one;
		const before = conversationIndex(feed);
		const streaming = {
			...original,
			messages: [...original.messages, message("agent", "More words")],
			usage: { ...original.usage, output: 20 },
		};
		feed.put(streaming);
		expect(conversationIndex(feed)).toBe(before);
		expect(feed.conversations[0]).toBe(streaming);
		feed.put({ ...streaming, unread: true });
		expect(conversationIndex(feed)).not.toBe(before);
		const unread = conversationIndex(feed);
		feed.put({
			...streaming,
			unread: true,
			messages: [message("agent", "## ✅ Merged alpha onto main\n\nDone.")],
		});
		expect(conversationIndex(feed)).not.toBe(unread);
		feed.dispose();
	});

	it("updates idle answers, removals, and identically named conversations from different projects", () => {
		const one = conversation({
			id: "same",
			status: "idle",
			messages: [message("agent", "1. Which way?")],
		});
		const source = {
			conversations: [
				{ ...one, project: "one" },
				{ ...one, project: "two" },
			],
		};
		const before = conversationIndex(source);
		source.conversations = [
			{
				...source.conversations[0],
				...one,
				project: "one",
				messages: [message("user", "Left")],
			},
			{ ...one, project: "two" },
		];
		const changed = conversationIndex(source);
		expect(changed[0]).not.toBe(before[0]);
		expect(changed[1]).toBe(before[1]);
		source.conversations = [];
		expect(conversationIndex(source)).toEqual([]);
	});

	// scry-ignore simple-test-setup: only this case renders three measured subscription probes and counts their separate commits
	it("profiles zero list and unrelated-thread commits while another conversation streams, and switches selection without an event", async () => {
		const commits = { list: 0, one: 0, two: 0 };
		function List(): JSX.Element {
			const rows = useConversationIndex(feed);
			const held = useHeldConversations();
			return (
				<p>
					{rows.length} rows, {held.length} held
				</p>
			);
		}
		function Thread({ id }: { id: string }): JSX.Element {
			const state = useConversation(feed, id);
			const held = useHeldConversations();
			return (
				<p>
					{state?.messages
						.at(-1)
						?.parts.map((part) => (part.type === "text" ? part.text : ""))
						.join()}{" "}
					/ {held.length}
				</p>
			);
		}
		const tree = (selected: string) => (
			<Talking feed={feed}>
				<Profiler id="list" onRender={() => commits.list++}>
					<List />
				</Profiler>
				<Profiler id="one" onRender={() => commits.one++}>
					<Thread id="one" />
				</Profiler>
				<Profiler id="two" onRender={() => commits.two++}>
					<Thread id={selected} />
				</Profiler>
			</Talking>
		);
		const view = render(tree("two"));
		const before = { ...commits };
		// scry-ignore matchers-over-test-logic: ten independent stream events measure whether each subscriber commits, rather than asserting inside a loop
		for (let index = 0; index < 10; index++) {
			await act(async () =>
				feed.put({ ...one, messages: [message("agent", `Word ${index}`)] }),
			);
		}
		expect(commits).toEqual({ ...before, one: before.one + 10 });
		view.rerender(tree("one"));
		expect(view.getAllByText("Word 9 / 2")).toHaveLength(2);
		feed.dispose();
	});
	// scry-ignore simple-test-setup: only this case renders the actual sidebar and thread tree; the feed and resources are shared in beforeEach
	it("profiles a stable sidebar and open thread while another conversation streams", async () => {
		const commits = { list: 0, thread: 0 };
		const open = () => {};
		const view = render(
			<ShortcutSettings value={settings}>
				<Talking feed={feed}>
					<DispatchingProvider
						feed={feed}
						drafts={drafts}
						tasks={[]}
						open={open}
					>
						<Profiler id="list" onRender={() => commits.list++}>
							<ConversationList
								feed={feed}
								terminals={terminals}
								tasks={[]}
								todos={[]}
								here={{ root: "/tmp/project", repo: "project", trunk: "main" }}
								open="two"
								onOpen={open}
							/>
						</Profiler>
						<Profiler id="thread" onRender={() => commits.thread++}>
							<Conversations
								feed={feed}
								terminals={terminals}
								drafts={drafts}
								tasks={[]}
								todos={[]}
								lanes={[]}
								trunk="main"
								here={{ root: "/repo", repo: "repo" }}
								open="two"
								onOpen={open}
								onTodos={open}
								onLane={open}
								phone={false}
							/>
						</Profiler>
					</DispatchingProvider>
				</Talking>
			</ShortcutSettings>,
		);
		await act(async () => {});
		const before = { ...commits };
		await act(async () =>
			feed.put({ ...one, messages: [message("agent", "More streamed words")] }),
		);
		expect(commits).toEqual(before);
		expect(view.getByRole("region", { name: "Two" })).toBeTruthy();
	});
});
