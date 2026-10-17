import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { until } from "./conversation-testing";
import { Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";
import { projectLine } from "./projects";
import { unknownLine } from "./systems";

describe("Conversation files", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		// The trees the agents run in, which a resume looks for.
		for (const tree of ["/repo", "/repo-arbor/login", "/repo-arbor/signup"]) {
			await fs.mkdir(tree);
		}
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		agent = new FakeAgent();
		conversations = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				root: "/repo",
				projects: {
					reach: async (from, to) =>
						from === "/repo" && to === "/Users/me/shop" ? "tasks" : "todos",
					list: async () => [
						{ slug: "shop", root: "/Users/me/shop", gone: false },
						{ slug: "playback", root: "/Users/me/playback", gone: false },
						{ slug: "old", root: "/Users/me/old", gone: true },
					],
				},
			},
		);
	});

	afterEach(() => conversations.disposeAsync());

	const started = async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	const PNG = {
		title: "shot.png",
		mimeType: "image/png",
		bytes: new TextEncoder().encode("png bytes"),
	};
	const DATA = btoa("png bytes");
	const MP4 = {
		title: "Bug Repro.MP4",
		mimeType: "video/mp4",
		bytes: new TextEncoder().encode("mp4 bytes"),
	};

	let tree: string;

	beforeEach(async () => {
		// Imported from disk, and read through `fs` to tell when it changed.
		tree = await mkdtemp(join(tmpdir(), "arbor-mentions-"));
		const systems = `export default ${JSON.stringify({ playback: { aliases: ["player"], globs: ["src/audio/**"] } })};\n`;
		await writeFile(join(tree, "arbor.systems.ts"), systems);
		await fs.mkdir(tree);
		await fs.write(join(tree, "arbor.systems.ts"), systems);
	});

	afterEach(() => rm(tree, { recursive: true, force: true }));

	it("sends images ahead of the words, keeps them beside the log, and reads them back", async () => {
		agent.sees = true;
		const conversation = await started();

		await conversation.prompt("look", [PNG]);
		await until(conversation, "idle");

		expect(agent.prompts).toEqual([
			[
				{ type: "image", mimeType: "image/png", data: DATA },
				{ type: "text", text: "look" },
			],
		]);
		const image = conversation.state.messages[0]?.parts[0];
		expect(image).toEqual({
			type: "image",
			name: expect.stringMatching(/^[0-9a-f]{16}\.png$/),
			mimeType: "image/png",
		});
		const name = image?.type === "image" ? image.name : "";
		const kept = await conversation.attachment(name);
		expect(new TextDecoder().decode(kept?.bytes)).toBe("png bytes");
		expect(kept?.mimeType).toBe("image/png");
		expect(await conversation.attachment("other.png")).toBeNull();
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.messages[0]?.parts).toEqual([
			{ type: "image", name, mimeType: "image/png" },
			{ type: "text", text: "look" },
		]);
		expect((await read?.attachment(name))?.mimeType).toBe("image/png");
	});

	it("sends an image with no words", async () => {
		agent.sees = true;
		const conversation = await started();

		await conversation.prompt("", [PNG]);
		await until(conversation, "idle");

		expect(agent.prompts).toEqual([
			[{ type: "image", mimeType: "image/png", data: DATA }],
		]);
	});

	it("sends any other file as a link to where it is kept, under the name the person gave it, and reads it back", async () => {
		agent.sees = true;
		const conversation = await started();

		await conversation.prompt("why", [MP4]);
		await until(conversation, "idle");

		const file = conversation.state.messages[0]?.parts[0];
		expect(file).toEqual({
			type: "file",
			name: expect.stringMatching(/^[0-9a-f]{16}\.mp4$/),
			title: "Bug Repro.MP4",
			mimeType: "video/mp4",
		});
		const name = file?.type === "file" ? file.name : "";
		expect(agent.prompts).toEqual([
			[
				{
					type: "resource_link",
					uri: `file:///repo/.git/arbor/conversations/${conversation.id}/${name}`,
					name: "Bug Repro.MP4",
					mimeType: "video/mp4",
				},
				{ type: "text", text: "why" },
			],
		]);
		const kept = await conversation.attachment(name);
		expect(new TextDecoder().decode(kept?.bytes)).toBe("mp4 bytes");
		await conversation.stop();
		const [read] = await new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		).list();
		expect(read?.state.messages[0]?.parts[0]).toEqual(file);
	});

	it("links an image to an agent that does not take images", async () => {
		const conversation = await started();

		await conversation.prompt("look", [PNG]);
		await until(conversation, "idle");

		expect(agent.prompts).toEqual([
			[
				expect.objectContaining({
					type: "resource_link",
					name: "shot.png",
					mimeType: "image/png",
				}),
				{ type: "text", text: "look" },
			],
		]);
	});

	it("identifies conversation UUIDs for the agent without treating them as unknown systems", async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: tree,
		});
		await until(conversation, "idle");
		const id = "550e8400-e29b-41d4-a716-446655440000";
		await conversation.prompt(`see #${id}`);
		await until(conversation, "idle");
		expect(agent.prompts.at(-1)).toEqual([
			{
				type: "text",
				text: `see #${id}\n\n#${id} references conversation ${id}. Its log is /repo/.git/arbor/conversations/${id}.jsonl.`,
			},
		]);
	});

	it("tells the agent what each one is made of, and keeps the words as typed in the thread", async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: tree,
		});
		await until(conversation, "idle");

		await conversation.prompt("Fix the gap in #player between tracks.");
		await until(conversation, "idle");

		expect(agent.prompts.at(-1)).toEqual([
			{
				type: "text",
				text: "Fix the gap in #player between tracks.\n\n#playback (player): src/audio/**",
			},
		]);
		expect(conversation.state.messages[0]).toMatchObject({
			parts: [{ type: "text", text: "Fix the gap in #player between tracks." }],
		});
	});

	it("asks the agent to find the code a # naming no system means, and leaves a todo's number alone", async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: tree,
		});
		await until(conversation, "idle");

		await conversation.prompt("See #12, #player and #mixer");
		await until(conversation, "idle");

		expect(agent.prompts.at(-1)).toEqual([
			{
				type: "text",
				text: `See #12, #player and #mixer\n\n#playback (player): src/audio/**\n${unknownLine("mixer")}`,
			},
		]);
	});

	it("tells the agent where a project it names sits, and lets a system of the same name win", async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: tree,
		});
		await until(conversation, "idle");

		await conversation.prompt(
			"Match the header in #shop, then #playback, #old and #mixer",
		);
		await until(conversation, "idle");

		expect(agent.prompts.at(-1)).toEqual([
			{
				type: "text",
				text: `Match the header in #shop, then #playback, #old and #mixer\n\n#playback (player): src/audio/**\n${projectLine({ slug: "shop", root: "/Users/me/shop", reach: "tasks" })}\n${unknownLine("old")}\n${unknownLine("mixer")}`,
			},
		]);
	});
});
