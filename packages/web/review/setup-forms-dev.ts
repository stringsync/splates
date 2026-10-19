/**
 * Serves the Setup forms design on fixtures, one screen per `?screen=`:
 * index, cred, select, text, working, failed, done, undo, undo-refused.
 * No server, store or account is touched: an undo answers from `PLANS`. Run `bun run build.ts` first so the styles hold the
 * page's classes, then `bun review/setup-forms-dev.ts [port]`.
 */

import { assets } from "@stringsync/splates-server/server";

const built = await Bun.build({
	entrypoints: [`${import.meta.dirname}/setup-forms-page.tsx`],
	target: "browser",
	define: { "process.env.NODE_ENV": '"production"' },
});
const js = await built.outputs[0]?.text();
if (!js) {
	throw new Error(String(built.logs));
}
/** What undoing each area would do, as the server plans it on a machine set up throughout. */
const PLANS: Record<string, unknown> = {
	coordinator: {
		area: "coordinator",
		title: "Cloud server",
		steps: [
			{
				id: "coordinator-keys",
				title: "Let the box push each project",
				removes: [],
				leaves: [
					"The deploy key `splates-coordinator` on stringsync/splates: delete it under its repository's Settings → Deploy keys on GitHub",
				],
			},
			{
				id: "coordinator-remotes",
				title: "Name each project's remote",
				removes: [],
				leaves: [
					'`remote: "origin"` stays in each project\'s `splates.config.ts`: land a change to take it out',
				],
			},
			{
				id: "coordinator-box",
				title: "Make the server's box",
				removes: [
					"The Hetzner server `splates-coordinator` in Ashburn and its daily backups",
					"Its firewall `splates-coordinator`",
					"Its SSH key `splates-coordinator`, in Hetzner and at `~/.splates/coordinator/id_ed25519`",
				],
				leaves: [
					"The Hetzner API token itself: delete it in the [Hetzner console](https://console.hetzner.cloud) under Security → API tokens",
				],
			},
		],
		creds: [{ name: "HCLOUD_TOKEN", keptFor: "Give splates a Hetzner token" }],
		confirm: "splates-coordinator",
		refused: null,
	},
	"remote-access": {
		area: "remote-access",
		title: "Remote access",
		steps: [],
		creds: [],
		confirm: null,
		refused:
			'Undo Workers first: its "Let workers through Access" needs "Make the tunnel".',
	},
};

const server = Bun.serve({
	port: Number(process.argv[2] ?? 0),
	async fetch(request) {
		const path = new URL(request.url).pathname;
		const undo = path.match(/^\/api\/setup\/([^/]+)\/undo$/)?.[1];
		if (undo !== undefined) {
			if (request.method === "POST") {
				// As long as a box takes to go, so Undoing… shows.
				await Bun.sleep(1500);
				return Response.json({
					areas: [],
					next: null,
					fresh: false,
					required: false,
				});
			}
			return Response.json(PLANS[undo] ?? null);
		}
		if (path === "/review.js") {
			return new Response(js, {
				headers: { "content-type": "text/javascript; charset=utf-8" },
			});
		}
		if (path === "/review.css") {
			return new Response(assets.styles, {
				headers: { "content-type": "text/css" },
			});
		}
		return new Response(
			'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/review.css"></head><body><div id="root"></div><script src="/review.js"></script></body></html>',
			{ headers: { "content-type": "text/html" } },
		);
	},
});
console.log(`setup forms design on ${server.url}`);
