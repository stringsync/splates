import { fail } from "../exit";
import type { Project } from "../server/shared";
import { Notes } from "./notes";

/** Read the project's landed notes from its main checkout. */
export class NotesRoutes {
	constructor(private readonly project: Project) {}

	readonly listNotes = async (): Promise<Response> => {
		const { service, fs } = this.project;
		return Response.json(
			await new Notes(fs).list(service.git.root, service.config),
		);
	};

	readonly readNote = async (request: Request): Promise<Response> => {
		const { service, fs } = this.project;
		const path = new URL(request.url).searchParams.get("path");
		const note = await new Notes(fs).read(
			service.git.root,
			path ?? "",
			service.config,
		);
		if (note === null) {
			fail("not_found", "That project note no longer exists.");
		}
		return Response.json(note);
	};
}
