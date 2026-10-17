import { db } from "./db";

export function serveBookmarks(port: number) {
	const search = async (request: Request): Promise<Response> => {
		const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
		const rows = await db.query("select * from bookmarks where archived = false");
		const found = rows
			.filter((row) => query === "" || row.title.toLowerCase().includes(query))
			.sort((left, right) => right.visits - left.visits)
			.slice(0, 20);
		if (found.length === 0) {
			return Response.json({ found: [], hint: "Try fewer words" });
		}
		return Response.json({ found, top: found[0].url });
	};

	return Bun.serve({
		port,
		routes: { "/api/search": search },
		fetch: () => new Response("not found", { status: 404 }),
	});
}
