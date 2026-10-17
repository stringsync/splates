import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import { Testing } from "./testing";

describe("dev artifacts", () => {
	let deps: Testing;
	let conversations: Conversations;

	beforeEach(async () => {
		deps = await Testing.open();
		const agent = new FakeAgent();
		conversations = new Conversations(
			`${deps.arborDir}/conversations`,
			[AGENT],
			{ launch: agent.launch },
		);
	});

	afterEach(() => deps.disposeAsync());

	it("sends a page to view, keeping its referrer, and anything the page cannot view as an attachment under its name", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			const { port } = server;
			const started = await json(port, "/api/conversations", "POST", {
				agent: "fake",
				task: null,
			});
			const { id } = (await started.json()) as { id: string };
			const conversation = await conversations.find(id);
			const encoder = new TextEncoder();
			await conversation.artifacts.add({
				name: "page.html",
				mimeType: "text/html",
				bytes: encoder.encode("<p>one</p>"),
			});
			await conversation.artifacts.add({
				name: "notes ü.pdf",
				mimeType: "application/pdf",
				bytes: encoder.encode("%PDF"),
			});
			const at = (name: string) =>
				fetch(
					`http://localhost:${port}/api/conversations/${id}/artifacts/${encodeURIComponent(name)}/1`,
				);

			const [page, notes] = [await at("page.html"), await at("notes ü.pdf")];
			expect({
				disposition: page.headers.get("content-disposition"),
				referrer: page.headers.get("referrer-policy"),
			}).toEqual({ disposition: null, referrer: "no-referrer" });
			expect({
				disposition: notes.headers.get("content-disposition"),
				referrer: notes.headers.get("referrer-policy"),
			}).toEqual({
				disposition: "attachment; filename*=UTF-8''notes%20%C3%BC.pdf",
				referrer: "no-referrer",
			});
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);
});
