/**
 * Serves the Setup forms design on fixtures, one screen per `?screen=`:
 * index, cred, select, text, working, failed, done. No server, store or
 * account is touched. Run `bun run build.ts` first so the styles hold the
 * page's classes, then `bun review/setup-forms-dev.ts [port]`.
 */

import { assets } from "@stringsync/splates-server/assets";

const built = await Bun.build({
	entrypoints: [`${import.meta.dirname}/setup-forms-page.tsx`],
	target: "browser",
	define: { "process.env.NODE_ENV": '"production"' },
});
const js = await built.outputs[0]?.text();
if (!js) {
	throw new Error(String(built.logs));
}
const server = Bun.serve({
	port: Number(process.argv[2] ?? 0),
	fetch(request) {
		const path = new URL(request.url).pathname;
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
