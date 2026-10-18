// Opens `<page>` in the browser the MCP at `<mcp>` drives and prints what
// it saw: `bun browse.ts <mcp> <page>`. Plain JSON-RPC over MCP's
// streamable HTTP, so the image needs no MCP client.
const [mcp, page] = process.argv.slice(2);
if (mcp === undefined || page === undefined) {
	throw new Error("usage: bun browse.ts <mcp> <page>");
}
let session: string | null = null;
let id = 0;

async function call(method: string, params: unknown): Promise<unknown> {
	const notify = method.startsWith("notifications/");
	const response = await fetch(mcp as string, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(session === null ? {} : { "mcp-session-id": session }),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			method,
			params,
			...(notify ? {} : { id: ++id }),
		}),
	});
	session = response.headers.get("mcp-session-id") ?? session;
	const body = await response.text();
	if (notify) {
		return null;
	}
	// An event stream carries the answer on a `data:` line.
	const json = body.startsWith("{")
		? body
		: (body
				.split("\n")
				.find((line) => line.startsWith("data:"))
				?.slice(5) ?? "{}");
	const answer = JSON.parse(json) as { result?: unknown; error?: unknown };
	if (answer.error !== undefined) {
		throw new Error(`${method}: ${JSON.stringify(answer.error)}`);
	}
	return answer.result;
}

await call("initialize", {
	protocolVersion: "2025-06-18",
	capabilities: {},
	clientInfo: { name: "browse", version: "1" },
});
await call("notifications/initialized", {});
const seen = (await call("tools/call", {
	name: "browser_navigate",
	arguments: { url: page },
})) as { content?: { type: string; text?: string }[] };
const text = (seen.content ?? []).map((each) => each.text ?? "").join("\n");
console.log(
	text
		.split("\n")
		.filter((line) => /title|served|error/i.test(line))
		.join("\n"),
);
