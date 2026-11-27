import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FakeAgent } from "@splates/server/agents/testing";
import { taskAdd } from "@splates/server/board";
import { Conversations } from "@splates/server/conversations";
import { HookStore } from "@splates/server/hooks";
import { dev } from "@splates/server/server";
import { Testing } from "@splates/server/testing";
import { OpenPortProvider } from "core/system";
import { Duration, SystemTimer, timeouts } from "core/time";
import { splates } from "./splates";

describe("signal fire from a shell hook", () => {
	let env: Testing;
	let deps: Parameters<typeof splates.run>[0];
	let posted: Array<{ url: string; body: Record<string, unknown> }>;

	beforeEach(async () => {
		env = await Testing.open();
		env.ps.cd(env.root);
		env.proc.env.SPLATES_DEV = "http://localhost:4310";
		delete env.proc.env.SPLATES_CONVERSATION;
		delete env.proc.env.ARBOR_CONVERSATION;
		delete env.proc.env.SPLATES_RIG;
		delete env.proc.env.SPLATES_HOOK;
		posted = [];
		deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
			secrets: env.secrets,
			fetch: Object.assign(
				async (input: string | URL | Request, init?: RequestInit) => {
					posted.push({
						url: String(input),
						body: JSON.parse(String(init?.body ?? "{}")) as Record<
							string,
							unknown
						>,
					});
					return Response.json({ delivered: 1 });
				},
				{ preconnect: () => {} },
			),
		};
	});

	afterEach(() => env.disposeAsync());

	it("attributes the firing to SPLATES_HOOK without a conversation", async () => {
		env.proc.env.SPLATES_HOOK = "Check Vexflow";

		await splates.run(deps, [
			"signal",
			"fire",
			"vexml.vexflow-updated",
			"--data",
			'{"latest":"5.1.0"}',
		]);

		expect(posted).toEqual([
			{
				url: "http://localhost:4310/api/signals/raise",
				body: {
					name: "vexml.vexflow-updated",
					by: "hook:Check Vexflow",
					payload: { latest: "5.1.0" },
				},
			},
		]);
	});

	it("ignores a blank SPLATES_HOOK and still requires a conversation", async () => {
		env.proc.env.SPLATES_HOOK = "   ";

		await splates.run(deps, ["signal", "fire", "vexml.vexflow-updated"]);
		expect(env.out()).toContain('"reason":"usage"');
		expect(env.out()).toContain("not in a `splates server` conversation");
		expect(posted).toEqual([]);
	});

	it("prefers an explicit --conversation over SPLATES_HOOK", async () => {
		env.proc.env.SPLATES_HOOK = "Check Vexflow";
		const id = "conv-123";
		await env.service.conversationLog(id).append({
			kind: "start",
			id,
			agent: "fake",
			task: null,
			cwd: env.root,
			createdAt: "2026-11-27T00:00:00.000Z",
		});

		await splates.run(deps, [
			"signal",
			"fire",
			"vexml.vexflow-updated",
			"--conversation",
			id,
		]);

		expect(posted).toEqual([
			{
				url: "http://localhost:4310/api/signals/raise",
				body: {
					name: "vexml.vexflow-updated",
					by: id,
				},
			},
		]);
	});
});

describe("server-run shell hooks firing signals", () => {
	// vet-ignore simple-test-setup: exercises a live server running shell hooks against its own signal endpoint.
	it("wakes a subscriber and attributes firings to named and config hooks", async () => {
		await using env = await Testing.open();
		const cliEntry = join(import.meta.dirname, "index.ts");
		const fireCmd = (name: string, payload: object) =>
			`bun ${JSON.stringify(cliEntry)} signal fire ${name} --data ${JSON.stringify(JSON.stringify(payload))}`;

		env.config.on = {
			"task.created": fireCmd("demo.from-config", { source: "config" }),
		};
		await new HookStore(env.storage).add(
			{ signal: "demo.tick" },
			{
				kind: "run",
				command: fireCmd("demo.from-sub", { source: "sub" }),
			},
			"Check Vexflow",
		);

		const agent = new FakeAgent();
		const woken: string[] = [];
		let resolveWoken: (() => void) | null = null;
		const nextWake = () =>
			new Promise<void>((resolve) => {
				resolveWoken = resolve;
			});
		agent.turn = async (_client, _session, text) => {
			woken.push(text);
			resolveWoken?.();
			resolveWoken = null;
			return "end_turn";
		};

		const server = await dev(env, {
			ports: OpenPortProvider.any(),
			conversations: ({ dir, storage }) =>
				new Conversations(
					`${dir}/conversations`,
					[{ id: "fake", name: "Fake", argv: ["fake-acp"] }],
					{
						storage: storage.within("conversations"),
						launch: agent.launch,
					},
				),
		});
		try {
			const url = `http://127.0.0.1:${server.port}`;
			const post = (path: string, body: object = {}) =>
				fetch(`${url}${path}`, {
					method: "POST",
					headers: { origin: url, "content-type": "application/json" },
					body: JSON.stringify(body),
				});

			const conversation = await post("/api/conversations", { agent: "fake" });
			expect(conversation.status).toBe(200);
			const { id } = (await conversation.json()) as { id: string };
			const convPath = `/api/conversations/${id}`;

			const waits = await Promise.all(
				["demo.from-sub", "demo.from-config"].map((sig) =>
					post(`${convPath}/signal-wait`, {
						name: sig,
						description: "A server-run shell hook fires this test signal.",
						timeout: "1h",
						since: "1m",
					}).then((res) => res.json()),
				),
			);
			expect(waits).toMatchObject([{ state: "waiting" }, { state: "waiting" }]);

			// Even if the server inherited a conversation id, shell hooks must attribute to the hook.
			env.proc.env.SPLATES_CONVERSATION = id;

			// 1. Named shell subscription triggered by a signal (as Check Vexflow is).
			const first = nextWake();
			const tickRes = await post("/api/signals/raise", {
				name: "demo.tick",
				by: "test",
			});
			expect(tickRes.status).toBe(200);
			expect(
				await timeouts.race(new SystemTimer(), first, Duration.secs(10)),
				"Named shell hook should wake the subscriber",
			).toBe(true);

			// 2. Checked-in config hook triggered by task.created.
			const second = nextWake();
			await env.journal.record(
				"task add",
				null,
				() => taskAdd(env, "trigger config hook", null),
				(task) => ({
					number: task.id,
					subject: task.subject,
					lane: null,
					position: task.position,
					ready: false,
				}),
			);
			expect(
				await timeouts.race(new SystemTimer(), second, Duration.secs(10)),
				"Config shell hook should wake the subscriber",
			).toBe(true);

			expect(woken.join("\n")).toContain("[SPLATES SIGNAL demo.from-sub]");
			expect(woken.join("\n")).toContain("[SPLATES SIGNAL demo.from-config]");

			const shown = (await (await fetch(`${url}${convPath}`)).json()) as {
				signals: Array<{
					name: string;
					state: string;
					raise?: { by: string; payload: unknown };
				}>;
			};
			expect(shown.signals).toContainEqual(
				expect.objectContaining({
					name: "demo.from-sub",
					state: "raised",
					raise: expect.objectContaining({
						by: "hook:Check Vexflow",
						payload: { source: "sub" },
					}),
				}),
			);
			expect(shown.signals).toContainEqual(
				expect.objectContaining({
					name: "demo.from-config",
					state: "raised",
					raise: expect.objectContaining({
						by: "hook:config:task.created",
						payload: { source: "config" },
					}),
				}),
			);
		} finally {
			await server.disposeAsync();
		}
	});
});
