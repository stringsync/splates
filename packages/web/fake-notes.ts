import type { ReadNote } from "@stringsync/splates-server/notes";

/** The notes a page test's server holds. */
export class FakeNotes {
	items: ReadNote[] = [];

	respond(path: string): Response | null {
		const url = new URL(path, "http://localhost");
		if (url.pathname === "/api/notes") {
			return Response.json(
				this.items.map(({ path, description }) => ({ path, description })),
			);
		}
		if (url.pathname !== "/api/notes/read") {
			return null;
		}
		const note = this.items.find(
			(note) => note.path === url.searchParams.get("path"),
		);
		return note === undefined
			? Response.json(
					{
						reason: "not_found",
						message: "That project note no longer exists.",
					},
					{ status: 404 },
				)
			: Response.json(note);
	}
}
