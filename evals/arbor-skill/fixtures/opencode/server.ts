// Free HTTP/SSE stand-in shaped from @opencode-ai/sdk 1.19.3. Never loads a model.
import { decisionTransport } from "../decision-transport";

const scenario = process.env.OPENCODE_FIXTURE ?? "success";
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
let permission: unknown;
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
const encoder = new TextEncoder();
const message = (id: string, input = 10) => ({
	id,
	sessionID: "owned",
	role: "assistant",
	cost: 0.001,
	tokens: { input, output: 2, reasoning: 1, cache: { read: 3, write: 4 } },
	time: { created: 1, completed: 2 },
	modelID: "model",
	providerID: "provider",
});
function event(type: string, properties: unknown) {
	stream?.enqueue(
		encoder.encode(`data: ${JSON.stringify({ type, properties })}\n\n`),
	);
}
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const path = url.pathname;
		if (path === "/global/health") {
			return Response.json({ healthy: true, version: "1.19.3-fixture" });
		}
		if (path === "/provider") {
			return Response.json({
				connected: scenario === "auth" ? [] : ["provider"],
				all: [{ id: "provider", models: { model: {} } }],
			});
		}
		if (path === "/skill") {
			return Response.json(
				scenario === "skill"
					? []
					: [
							{
								name: "arbor",
								location: `${process.env.HOME}/.config/opencode/skills/arbor/SKILL.md`,
							},
						],
			);
		}
		if (path === "/session" && request.method === "POST") {
			const body = (await request.json()) as { permission: unknown };
			permission = body.permission;
			return Response.json({
				id: "owned",
				permission: scenario === "permissions" ? [] : permission,
			});
		}
		if (path === "/session/owned/children") {
			return Response.json(
				scenario === "children" ? [{ id: "child", parentID: "owned" }] : [],
			);
		}
		if (path === "/session/child/children") {
			return Response.json([]);
		}
		if (path === "/session/child/message") {
			return Response.json([
				{ info: { ...message("first"), sessionID: "child" } },
			]);
		}
		if (path === "/session/child/abort") {
			return Response.json(true);
		}
		if (path === "/event") {
			return new Response(
				new ReadableStream({
					start(controller) {
						stream = controller;
						controller.enqueue(encoder.encode(": connected\n\n"));
					},
				}),
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		}
		if (path === "/session/owned/abort") {
			await Bun.write(`${process.env.HOME}/aborted`, "owned");
			return Response.json(true);
		}
		if (path === "/session/owned/message" && request.method === "POST") {
			const body = await request.json();
			await Bun.write(
				`${process.env.HOME}/request.json`,
				JSON.stringify({
					body,
					config,
					permission,
					directory: url.searchParams.get("directory"),
				}),
			);
			if (scenario === "http-error") {
				return new Response("failure", { status: 500 });
			}
			event("message.updated", {
				info: { ...message("unrelated", 999), sessionID: "other" },
			});
			if (scenario === "children") {
				event("session.created", { info: { id: "child", parentID: "owned" } });
				event("message.updated", {
					info: { ...message("first"), sessionID: "child" },
				});
			}
			event("message.updated", { info: message("first") });
			event("message.updated", { info: message("first", 1) });
			event("message.updated", { info: message("first") });
			event("message.part.updated", {
				part: {
					sessionID: "owned",
					type: "tool",
					tool: "bash",
					state: {
						status: "completed",
						input: { command: "arbor merge" },
						output: "proposed",
					},
				},
			});
			if (scenario === "stream-auth") {
				event("session.error", {
					sessionID: "owned",
					error: { name: "ProviderAuthError" },
				});
				await Bun.sleep(100);
			}
			if (scenario === "stream-end") {
				stream?.close();
				await Bun.sleep(100);
			}
			if (scenario === "cancel") {
				event("message.updated", { info: message("overshoot", 200) });
				await Bun.sleep(10000);
			}
			if (scenario === "provider-error") {
				return Response.json({
					info: { ...message("last"), error: { name: "ProviderAuthError" } },
					parts: [],
				});
			}
			return Response.json({
				info:
					scenario === "unknown"
						? {
								id: "last",
								sessionID: "owned",
								role: "assistant",
								providerID: "provider",
								modelID: "model",
							}
						: message("last"),
				parts: [
					{
						type: "text",
						text: await decisionTransport(
							url.searchParams.get("directory") ?? process.cwd(),
							process.env.NATIVE_DECISION_FIXTURE,
						),
					},
				],
			});
		}
		if (path === "/session/owned/message") {
			return Response.json([
				{ info: message("first") },
				{
					info:
						scenario === "unknown"
							? {
									id: "last",
									sessionID: "owned",
									role: "assistant",
									providerID: "provider",
									modelID: "model",
								}
							: message("last"),
				},
			]);
		}
		return new Response("not found", { status: 404 });
	},
});
if (scenario === "startup") {
	process.exit(7);
}
process.stdout.write(
	`opencode server listening on http://127.0.0.1:${server.port}\n`,
);
