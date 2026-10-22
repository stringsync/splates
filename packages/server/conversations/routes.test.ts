import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { AGENT, FakeAgent, heard, ROSTERED, say } from "../agents/testing";
import { dev } from "../server";
import { eventually, json, readUntil, serving } from "../server/testing";
import { add } from "../tasks";
import { Testing } from "../testing";
import { Conversations } from "./conversations";
import type { ConversationState } from "./state";

function get(port: number, path: string): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}${path}`);
}

describe("dev conversations", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let server: Awaited<ReturnType<typeof dev>>;
	let port: number;
	let said: string[];
	let tree: string;

	beforeEach(async () => {
		deps = await Testing.open();
		await add(deps, "alpha");
		tree = (await deps.service.find("alpha")).path;
		agent = new FakeAgent();
		said = [];
		agent.turn = async (client, sessionId, text) => {
			said.push(text);
			await client.sessionUpdate({ sessionId, update: say("Hello ") });
			await client.sessionUpdate({ sessionId, update: say("there.") });
			return "end_turn";
		};
		conversations = new Conversations(`${deps.dir}/conversations`, [AGENT], {
			storage: deps.storage.within("conversations"),
			launch: agent.launch,
		});
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			hosts: ["repo.splates.example"],
			conversations: () => conversations,
		});
		({ port } = server);
	});

	afterEach(async () => {
		await server.disposeAsync();
		await deps.disposeAsync();
	});

	/** A conversation started through the page, with no task. */
	const opened = async () => {
		const id = await start(port, null);
		return { id, conversation: await conversations.find(id) };
	};

	it("says they are off unless asked for", async () => {
		await serving(deps, async (_, port) => {
			const response = await get(port, `/api/conversations`);

			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({
				reason: "not_found",
				message: "conversations are off",
			});
		});
	});

	it("starts the agent of a task handed to one, in its tree", async () => {
		await add(deps, "delta", {
			dispatch: { agent: "fake", model: "Small", prompt: "Do the part." },
			agents: [ROSTERED],
		});
		await eventually(async () => said.length === 1, 2_000);
		const alpha = await deps.service.find("delta");
		const [started] = await conversations.list();

		expect(said).toEqual(["[SPLATES TASK delta]\n\nDo the part."]);
		expect(agent.launched.map((each) => each.cwd)).toEqual([alpha.path]);
		expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
		expect(started?.state.task).toBe("delta");
		expect(alpha.state?.dispatch?.conversation).toBe(started?.id);
	});

	it("starts the agent of a task handed over while the server runs, with no page listening", async () => {
		await add(deps, "beta", {
			dispatch: { agent: "fake" },
			agents: [ROSTERED],
		});
		await eventually(async () => said.length === 1, 2_000);

		expect(said).toEqual(["[SPLATES TASK beta]"]);
	});

	it("starts each handed task once, however often the server starts, and waits for a tree still readying", async () => {
		await add(deps, "delta", {
			dispatch: { agent: "fake" },
			agents: [ROSTERED],
		});
		await eventually(async () => agent.launched.length === 1, 2_000);
		await server.disposeAsync();
		await add(deps, "gamma", {
			dispatch: { agent: "fake" },
			agents: [ROSTERED],
		});
		const gamma = await deps.service.find("gamma");
		await gamma.save({
			dispatch: { ...gamma.state?.dispatch, agent: "fake", pending: true },
			// The add that left it pending is still running.
			lease: {
				pid: deps.ps.pid,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		await Bun.sleep(200);

		expect(agent.launched).toHaveLength(1);
	});

	it("lists the sessions in a task's tree", async () => {
		agent.held = [{ ...held, cwd: tree }];

		const listed = await get(port, "/api/conversations/sessions?task=alpha");

		expect(await listed.json()).toEqual([
			{
				agent: "fake",
				session: "cli-1",
				title: "From the CLI",
				updatedAt: null,
			},
		]);
	});

	it("brings a session of a task's tree in, with what was said in it", async () => {
		agent.held = [{ ...held, cwd: tree }];

		const brought = await json(port, "/api/conversations/sessions", "POST", {
			agent: "fake",
			session: "cli-1",
			task: "alpha",
			title: "From the CLI",
		});
		const { id } = (await brought.json()) as { id: string };
		const conversation = await conversations.find(id);
		await eventually(async () => conversation.state.status === "idle", 2_000);

		expect(brought.status).toBe(200);
		expect(conversation.state).toMatchObject({
			task: "alpha",
			title: "From the CLI",
			messages: [
				{ role: "user", parts: [{ type: "text", text: "hello" }] },
				{ role: "agent", parts: [{ type: "text", text: "Hi." }] },
			],
		});
		expect(agent.launched.at(-1)?.cwd).toBe(tree);
	});

	it("starts one in a task's tree with its own id in the agent's env", async () => {
		const listed = await (await get(port, "/api/conversations")).json();

		const id = await start(port, "alpha");

		expect(listed).toEqual({
			agents: [
				{ id: "fake", name: "Fake", models: [], settings: [], limits: [] },
			],
			conversations: [],
		});
		expect(agent.launched).toEqual([
			{
				argv: ["fake-acp"],
				cwd: tree,
				env: {
					SPLATES_CONVERSATION: id,
					SPLATES_DEV: `http://127.0.0.1:${port}`,
				},
			},
		]);
	});

	it("starts each connection in summary and streams later metadata as deltas", async () => {
		const { id, conversation } = await opened();
		const events = await get(port, "/api/conversations/events");
		const reader = (events.body as ReadableStream<Uint8Array>).getReader();
		const initial = await readUntil(reader, `"id":"${id}"`);
		expect(initial).toContain('"messages":[]');
		expect(initial).toContain('"summary":true');
		conversation.state.name = "delta-name";
		conversation.changed();
		const delta = await readUntil(reader, '"name":"delta-name"');
		expect(delta).toContain("event: delta");
		expect(delta).not.toContain('"agent":');
		await reader.cancel();
		const reconnected = await get(port, "/api/conversations/events");
		const again = (reconnected.body as ReadableStream<Uint8Array>).getReader();
		const snapshot = await readUntil(again, '"name":"delta-name"');
		expect(snapshot).toContain('"messages":[]');
		expect(snapshot).not.toContain("event: delta");
		await again.cancel();
	});

	it("streams the agent's turn", async () => {
		const id = await start(port, "alpha");
		const events = await get(port, "/api/conversations/events");
		const reader = (events.body as ReadableStream<Uint8Array>).getReader();

		await prompt(port, id);
		const heardBack = await readUntil(reader, "Hello there.");
		await reader.cancel();

		expect(heardBack).toContain('"role":"agent"');
	});

	it("plays the file sent with a prompt from the server, a part at a time", async () => {
		const id = await start(port, "alpha");
		await prompt(port, id);
		const sent = (await conversations.find(id)).state.messages[0]?.parts[0];

		const played = await fetch(
			`http://127.0.0.1:${port}/api/conversations/${id}/attachments/${(sent as { name: string }).name}`,
			{ headers: { range: "bytes=0-2" } },
		);

		expect(sent).toMatchObject({ type: "file", title: "bug.mp4" });
		expect(played.status).toBe(206);
		expect(played.headers.get("content-type")).toBe("video/mp4");
		expect(await played.text()).toBe("mp4");
	}, 15_000);

	it("pins one, and stops it when archived", async () => {
		const id = await start(port, "alpha");

		const pinned = await json(port, `/api/conversations/${id}/pinned`, "PUT", {
			pinned: true,
		});
		const archived = await json(
			port,
			`/api/conversations/${id}/archived`,
			"PUT",
			{ archived: true },
		);

		expect(await pinned.json()).toMatchObject({ id, pinned: true });
		expect(await archived.json()).toMatchObject({
			id,
			status: "stopped",
			archived: true,
		});
		expect(agent.killed).toBe(1);
	});

	// scry-ignore simple-test-setup: only the server's automations start a persistent agent, never the page, so this one starts it directly.
	it("refuses to archive a persistent agent's conversation, which its automation retires", async () => {
		const groomer = await conversations.start("fake", {
			task: null,
			cwd: deps.service.git.root,
			persistent: "groomer",
		});

		const refused = await json(
			port,
			`/api/conversations/${groomer.id}/archived`,
			"PUT",
			{ archived: true },
		);

		expect(refused.status).toBe(400);
		expect(await refused.text()).toContain("Automations page");
		expect(groomer.state.archived).toBe(false);
	});

	it.each([false, true])(
		"lists a summary with archived=%s, and serves it whole",
		async (archived) => {
			agent.turn = async (client, sessionId) => {
				await client.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "tool_call",
						toolCallId: "t1",
						title: "Run ls",
						kind: "execute",
						status: "completed",
					},
				});
				await client.sessionUpdate({ sessionId, update: say("Done.") });
				return "end_turn";
			};
			const { id, conversation } = await opened();
			await conversation.prompt("go");
			// The turn ends when the agent says so, not when its last words have
			// been taken in: archive once the reply is in the conversation.
			await eventually(
				async () => types(conversation.state).length === 3,
				5_000,
			);
			await json(port, `/api/conversations/${id}/archived`, "PUT", {
				archived,
			});
			const { conversations: listed } = (await (
				await get(port, `/api/conversations`)
			).json()) as { conversations: ConversationState[] };
			const whole = (await (
				await get(port, `/api/conversations/${id}`)
			).json()) as ConversationState;

			expect(listed[0]?.summary).toBe(true);
			expect(types(listed[0] as ConversationState)).toEqual(["text", "text"]);
			expect(whole.summary).toBeUndefined();
			expect(types(whole)).toEqual(["text", "tool", "text"]);
		},
	);

	it("serves a version of an artifact, 404 gone once its bytes are deleted and 404 not_found for an unknown one", async () => {
		const { id, conversation } = await opened();
		const encoder = new TextEncoder();
		await conversation.artifacts.add({
			name: "page.html",
			mimeType: "text/html",
			bytes: encoder.encode("<p>one</p>"),
		});
		await conversation.artifacts.add({
			name: "page.html",
			mimeType: "text/html",
			bytes: encoder.encode("<p>two</p>"),
		});
		const at = (name: string, version: number) =>
			get(port, `/api/conversations/${id}/artifacts/${name}/${version}`);

		const page = await at("page.html", 2);
		const policy = page.headers.get("content-security-policy") ?? "";
		const pageText = await page.text();
		await conversation.artifacts.delete("page.html", 1, "deleted");
		const gone = await at("page.html", 1);
		const kept = await at("page.html", 2);
		const unknown = [await at("page.html", 3), await at("other.png", 1)];

		expect(page.status).toBe(200);
		expect(pageText).toBe("<p>two</p>");
		expect(page.headers.get("content-type")).toBe("text/html");
		expect(policy).toContain("sandbox allow-scripts;");
		expect(policy).not.toContain("allow-same-origin");
		expect(policy).toContain("frame-ancestors 'self'");
		expect(gone.status).toBe(404);
		expect(await gone.json()).toMatchObject({ reason: "gone" });
		expect(kept.status).toBe(200);
		expect(unknown.map((each) => each.status)).toEqual([404, 404]);
		expect(await Promise.all(unknown.map((each) => each.json()))).toEqual([
			expect.objectContaining({ reason: "not_found" }),
			expect.objectContaining({ reason: "not_found" }),
		]);
	}, 15_000);

	it("deletes one version's bytes on a DELETE of that version, keeping the artifact listed", async () => {
		const { id, conversation } = await opened();
		const add = (text: string) =>
			conversation.artifacts.add({
				name: "page.html",
				mimeType: "text/html",
				bytes: new TextEncoder().encode(text),
			});
		await add("one");
		await add("two");
		const at = (version: string) =>
			`http://127.0.0.1:${port}/api/conversations/${id}/artifacts/page.html/${version}`;
		const del = (version: string) =>
			fetch(at(version), {
				method: "DELETE",
				headers: { origin: `http://127.0.0.1:${port}` },
			});

		const deleted = await del("1");
		const goneAfter = await fetch(at("1"));
		const keptAfter = await fetch(at("2"));
		const unknown = await del("9");
		const malformed = await del("x");

		expect(deleted.status).toBe(200);
		expect(goneAfter.status).toBe(404);
		expect(keptAfter.status).toBe(200);
		expect(conversation.state.artifacts[0]?.removedAt).toBeNull();
		expect(conversation.state.artifacts[0]?.versions[0]?.gone).toMatchObject({
			why: "deleted",
		});
		expect(unknown.status).toBe(404);
		expect(malformed.ok).toBe(false);
	}, 15_000);

	it("refuses a conversation in a task with no worktree", async () => {
		const response = await json(server.port, "/api/conversations", "POST", {
			agent: "fake",
			task: "nope",
		});

		expect(response.status).toBe(404);
		expect(agent.launched).toEqual([]);
	});

	it("removes a task, stopping each conversation in its tree and moving it to the main tree", async () => {
		const id = await start(port, "alpha");
		const conversation = await conversations.find(id);
		await eventually(
			async () => conversation.state.status !== "starting",
			2_000,
		);
		const removeAs = (host: string) =>
			fetch(`http://127.0.0.1:${port}/api/tasks/alpha`, {
				method: "DELETE",
				headers: { host, origin: `http://${host}` },
			});

		// It discards work, so it answers only to this machine.
		const refused = await removeAs("repo.splates.example");
		const refusedGone = (await deps.service.find("alpha")).gone;
		const removed = await removeAs(`localhost:${port}`);

		expect(refused.status).toBe(403);
		expect(refusedGone).toBe(false);
		expect(removed.status).toBe(200);
		expect((await deps.service.find("alpha")).gone).toBe(true);
		expect(conversation.state).toMatchObject({
			task: null,
			lastTask: "alpha",
			status: "stopped",
			archived: false,
		});
		expect(agent.killed).toBe(1);
		expect(await (await removeAs(`localhost:${port}`)).json()).toMatchObject({
			reason: "already_removed",
		});
	});

	it("follows its agent into a task, but not into a part of its own task", async () => {
		await add(deps, "part", { base: "task/alpha" });
		await add(deps, "subpart", { base: "task/part" });
		await add(deps, "beta");
		const id = await start(port, "alpha");
		const moveTo = async (task: string, base?: string) =>
			(
				(await (
					await json(port, `/api/conversations/${id}/task`, "PUT", {
						task,
						base,
					})
				).json()) as ConversationState
			).task;

		// A subagent claiming a part runs with this conversation's env.
		const part = await moveTo("part");
		const subpart = await moveTo("subpart");
		// Handing a part out tells the server before its record names the
		// base, so the add sends the base itself.
		const added: (string | null)[] = [];
		await add(deps, "late", {
			base: "task/alpha",
			onTree: async () => {
				added.push(await moveTo("late", "task/alpha"));
			},
		});
		const beta = await moveTo("beta");

		expect([part, subpart, added, beta]).toEqual([
			"alpha",
			"alpha",
			["alpha"],
			"beta",
		]);
	});

	it("answers only to this machine, even for a host the board lets in", async () => {
		const as = (host: string, path: string) =>
			fetch(`http://127.0.0.1:${server.port}${path}`, {
				headers: { host },
			});

		const snapshot = await as("repo.splates.example", "/api/snapshot");
		const refused = await as("repo.splates.example", "/api/conversations");
		const local = await as(`localhost:${server.port}`, "/api/conversations");

		expect(snapshot.status).toBe(200);
		expect(refused.status).toBe(403);
		expect(await refused.json()).toMatchObject({
			message:
				"conversations and terminals run commands on this machine: open the page on it, or put Cloudflare Access in front with --access-team and --access-aud",
		});
		expect(local.status).toBe(200);
	});

	it("refuses a start from another site", async () => {
		const response = await fetch(
			`http://127.0.0.1:${server.port}/api/conversations`,
			{
				method: "POST",
				headers: { origin: "https://evil.example" },
				body: JSON.stringify({ agent: "fake" }),
			},
		);

		expect(response.status).toBe(403);
		expect(agent.launched).toEqual([]);
	});
});

const held = {
	sessionId: "cli-1",
	title: "From the CLI",
	replay: [heard("hello"), say("Hi.")],
};

/** A prompt with a file, sent again until the agent has opened its session. */
async function prompt(port: number, id: string): Promise<void> {
	const form = new FormData();
	form.set("text", "hi");
	form.append(
		"file",
		new File(["mp4 bytes"], "bug.mp4", { type: "video/mp4" }),
	);
	await eventually(
		async () =>
			(
				await fetch(`http://127.0.0.1:${port}/api/conversations/${id}/prompt`, {
					method: "POST",
					headers: { origin: `http://127.0.0.1:${port}` },
					body: form,
				})
			).status === 200,
		2_000,
	);
}

async function start(port: number, task: string | null): Promise<string> {
	const started = await json(port, "/api/conversations", "POST", {
		agent: "fake",
		task,
	});
	return ((await started.json()) as { id: string }).id;
}

function types(state: ConversationState): string[] {
	return state.messages.flatMap((message) =>
		message.parts.map((part) => part.type),
	);
}
