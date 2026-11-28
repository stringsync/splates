import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { FakeFs } from "core/system/testing";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import { FakeAgent } from "../agents/testing";
import { Conversations, capturedMedia } from "./index";
import { eventually, until } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

const PNG_A = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
]);
const PNG_B = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2,
]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86]);
const SVG = new TextEncoder().encode(
	'<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
);

describe("Conversation inline media auto-capture", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;
	const DIR = "/repo/.git/splates/conversations";

	const makeConversations = (
		artifacts = {
			file: 50 * 1024 * 1024,
			conversation: 250 * 1024 * 1024,
			project: 2 * 1024 * 1024 * 1024,
		},
	) =>
		new Conversations(DIR, [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			artifacts,
		});

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo");
		await fs.mkdir("/repo-splates/login");
		await fs.mkdir("/tmp");
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		agent = new FakeAgent();
		conversations = makeConversations();
	});

	afterEach(() => conversations.disposeAsync());

	it("captures absolute, file://, and relative media with an open task and replays durably", async () => {
		await fs.writeBytes("/tmp/abs.png", PNG_A);
		await fs.writeBytes("/tmp/clip.webm", WEBM);
		await fs.writeBytes("/repo-splates/login/shots/rel.svg", SVG);
		agent.turn = async (client, sessionId) => {
			// Stream across chunk boundaries to exercise live streaming capture.
			for (const text of [
				"Here is ![abs](/tmp/",
				"abs.png) and ![url](file:///tmp/clip.webm) and ![rel](./shots/rel.svg)\n",
				"Code stays raw: `![raw](/tmp/abs.png)`",
			]) {
				await client.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text },
					},
				});
			}
			return "end_turn";
		};

		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		await conversation.prompt("show me");
		await until(conversation, "idle");
		await conversation.saved();

		const reply = conversation.state.messages
			.findLast((each) => each.role === "agent")
			?.parts.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
		expect(reply).toBeDefined();
		expect(reply).not.toContain("![abs](/tmp/abs.png)");
		expect(reply).not.toContain("file:///tmp/clip.webm");
		expect(reply).not.toContain("./shots/rel.svg");
		expect(reply).toContain("`![raw](/tmp/abs.png)`");

		const storedPaths = [...(reply ?? "").matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)]
			.map((match) => match[1] ?? "")
			.filter((path) =>
				path.startsWith(`${DIR}/${conversation.id}/attached/login/`),
			);
		expect(storedPaths).toHaveLength(3);
		expect(await fs.readBytes(storedPaths[0] ?? "")).toEqual(PNG_A);
		expect(await fs.readBytes(storedPaths[1] ?? "")).toEqual(WEBM);
		expect(await fs.readBytes(storedPaths[2] ?? "")).toEqual(SVG);

		// Delete the originals, stop, and replay the log from disk.
		await fs.rm("/tmp/abs.png");
		await fs.rm("/tmp/clip.webm");
		await fs.rm("/repo-splates/login/shots/rel.svg");
		await conversation.stop();

		const replayed = makeConversations();
		try {
			const read = await replayed.find(conversation.id);
			const replayedReply = read.state.messages
				.findLast((each) => each.role === "agent")
				?.parts.map((part) => (part.type === "text" ? part.text : ""))
				.join("");
			expect(replayedReply).toBe(reply);
			const map = await capturedMedia(read.log.log);
			expect(map.get("/tmp/abs.png")).toBe(storedPaths[0]);
			expect(map.get("/tmp/clip.webm")).toBe(storedPaths[1]);
			expect(map.get("/repo-splates/login/shots/rel.svg")).toBe(storedPaths[2]);
		} finally {
			await replayed.disposeAsync();
		}
	});

	it("captures inline media without an open task under _no-task", async () => {
		await fs.writeBytes("/tmp/free.png", PNG_A);
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "![free](/tmp/free.png)" },
				},
			});
			return "end_turn";
		};

		const conversation = await conversations.start("fake", {
			task: null,
			cwd: "/repo",
		});
		await until(conversation, "idle");
		await conversation.prompt("show");
		await until(conversation, "idle");

		const reply = conversation.state.messages
			.findLast((each) => each.role === "agent")
			?.parts.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
		expect(reply).toMatch(
			new RegExp(
				`^!\\[free\\]\\(${DIR}/${conversation.id}/attached/_no-task/[0-9a-f]{16}-free\\.png\\)$`,
			),
		);
	});

	it("rejects non-media files and renamed text files", async () => {
		await fs.write("/etc/secret", "TOP_SECRET=1\n");
		await fs.write("/tmp/fake.png", "SECRET_TOKEN=abc\n");
		await fs.write("/tmp/fake.svg", "<!DOCTYPE html><html><svg/></html>");
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "text",
						text: "![a](/etc/secret) ![b](/tmp/fake.png) ![c](/tmp/fake.svg)",
					},
				},
			});
			return "end_turn";
		};

		const conversation = await conversations.start("fake", {
			task: null,
			cwd: "/repo",
		});
		await until(conversation, "idle");
		await conversation.prompt("try");
		await until(conversation, "idle");

		const reply = conversation.state.messages
			.findLast((each) => each.role === "agent")
			?.parts.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
		expect(reply).toBe(
			"![a](/etc/secret) ![b](/tmp/fake.png) ![c](/tmp/fake.svg)",
		);
		expect(await fs.exists(`${DIR}/${conversation.id}/attached/_no-task`)).toBe(
			false,
		);
	});

	it("enforces file and conversation size caps and deduplicates repeated captures", async () => {
		const bigPng = new Uint8Array(24);
		bigPng.set(PNG_A);
		const smallA = PNG_A; // 9 bytes
		const smallB = PNG_B; // 9 bytes
		await fs.writeBytes("/tmp/big.png", bigPng);
		await fs.writeBytes("/tmp/a.png", smallA);
		await fs.writeBytes("/tmp/b.png", smallB);

		await conversations.disposeAsync();
		// Allow 15 bytes per file, 15 bytes per conversation: big (24) fails file cap,
		// a (9) fits, duplicate a (9) reuses without double-counting, b (9 -> 18) fails conversation cap.
		conversations = makeConversations({
			file: 15,
			conversation: 15,
			project: 1000,
		});
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "text",
						text: "![big](/tmp/big.png) ![a1](/tmp/a.png) ![a2](/tmp/a.png) ![b](/tmp/b.png)",
					},
				},
			});
			return "end_turn";
		};

		const conversation = await conversations.start("fake", {
			task: null,
			cwd: "/repo",
		});
		await until(conversation, "idle");
		await conversation.prompt("cap");
		await until(conversation, "idle");

		const reply = conversation.state.messages
			.findLast((each) => each.role === "agent")
			?.parts.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
		expect(reply).toContain("![big](/tmp/big.png)");
		expect(reply).toContain("![b](/tmp/b.png)");
		expect(reply).not.toContain("![a1](/tmp/a.png)");
		expect(reply).not.toContain("![a2](/tmp/a.png)");
		const a1 = /!\[a1\]\(([^)]+)\)/.exec(reply ?? "")?.[1];
		const a2 = /!\[a2\]\(([^)]+)\)/.exec(reply ?? "")?.[1];
		expect(a1).toBeDefined();
		expect(a2).toBe(a1);
	});

	it("preserves both snapshots when the same path is overwritten mid-turn and on replay", async () => {
		await fs.writeBytes("/tmp/live.png", PNG_A);
		let conversation: Awaited<ReturnType<Conversations["start"]>> | null = null;
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Before: ![before](/tmp/live.png)" },
				},
			});
			// Wait for the server to receive and capture part 1 before overwriting the file.
			await eventually(() => {
				const text =
					conversation?.state.messages
						.findLast((each) => each.role === "agent")
						?.parts.find((part) => part.type === "text")?.text ?? "";
				return text.includes("/attached/login/");
			});
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "update screenshot",
					status: "completed",
				},
			});
			await fs.writeBytes("/tmp/live.png", PNG_B);
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "After: ![after](/tmp/live.png)" },
				},
			});
			return "end_turn";
		};

		conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		await conversation.prompt("compare");
		await until(conversation, "idle");
		await conversation.saved();

		const parts = (
			conversation.state.messages.findLast((each) => each.role === "agent")
				?.parts ?? []
		).filter((part) => part.type === "text");
		const first =
			/!\[before\]\(([^)]+)\)/.exec(parts[0]?.text ?? "")?.[1] ?? "";
		const second =
			/!\[after\]\(([^)]+)\)/.exec(parts[1]?.text ?? "")?.[1] ?? "";
		expect(first).not.toBe("");
		expect(second).not.toBe("");
		expect(first).not.toBe(second);
		expect(await fs.readBytes(first)).toEqual(PNG_A);
		expect(await fs.readBytes(second)).toEqual(PNG_B);

		await conversation.stop();
		const replayed = makeConversations();
		try {
			const read = await replayed.find(conversation.id);
			const replayedParts = (
				read.state.messages.findLast((each) => each.role === "agent")?.parts ??
				[]
			).filter((part) => part.type === "text");
			expect(replayedParts[0]?.text).toBe(parts[0]?.text);
			expect(replayedParts[1]?.text).toBe(parts[1]?.text);
		} finally {
			await replayed.disposeAsync();
		}
	});

	it("auto-captures embedded local HTML files as conversation artifacts while leaving plain HTML links alone", async () => {
		const html = new TextEncoder().encode(
			"<!doctype html><html><head><title>Pricing Simulator</title></head><body><p>Hi</p></body></html>",
		);
		await fs.writeBytes("/tmp/pricing-sim.html", html);
		await fs.writeBytes("/tmp/index.html", html);
		agent.turn = async (client, sessionId) => {
			for (const text of [
				"Try ![Pricing](/tmp/pricing-sim.html) and see [index.html](/tmp/index.html).",
			]) {
				await client.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text },
					},
				});
			}
			return "end_turn";
		};

		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		await conversation.prompt("show html");
		await until(conversation, "idle");
		await conversation.saved();

		const reply = conversation.state.messages
			.findLast((each) => each.role === "agent")
			?.parts.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
		expect(reply).toBe(
			"Try ![Pricing](#splates-artifact=pricing-sim.html/1) and see [index.html](/tmp/index.html).",
		);
		expect(conversation.state.artifacts).toMatchObject([
			{
				name: "pricing-sim.html",
				current: 1,
				versions: [
					{
						version: 1,
						mimeType: "text/html",
						title: "Pricing Simulator",
					},
				],
			},
		]);

		// Deleting the original file and replaying still keeps the artifact and rewrite.
		await fs.rm("/tmp/pricing-sim.html");
		await conversation.stop();
		const replayed = makeConversations();
		try {
			const read = await replayed.find(conversation.id);
			const replayedReply = read.state.messages
				.findLast((each) => each.role === "agent")
				?.parts.map((part) => (part.type === "text" ? part.text : ""))
				.join("");
			expect(replayedReply).toBe(reply);
			expect(read.state.artifacts).toHaveLength(1);
			expect((await read.artifacts.read("pricing-sim.html", 1))?.bytes).toEqual(
				html,
			);
		} finally {
			await replayed.disposeAsync();
		}
	});
});
