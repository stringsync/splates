import type { Bookmarks } from "./bookmarks";

export function serveBookmarks(bookmarks: Bookmarks, port: number) {
	const search = async (request: Request): Promise<Response> =>
		Response.json(await bookmarks.search(new URL(request.url).searchParams.get("q") ?? ""));

	const save = async (request: Request): Promise<Response> => {
		const form = await request.formData();
		const bookmark = await bookmarks.save({
			url: String(form.get("url") ?? ""),
			title: form.has("title") ? String(form.get("title")) : undefined,
		});
		return Response.json(bookmark, { status: 201 });
	};

	return Bun.serve({
		port,
		routes: { "/api/search": search, "/api/bookmarks": { POST: save } },
		fetch: () => new Response("not found", { status: 404 }),
	});
}
