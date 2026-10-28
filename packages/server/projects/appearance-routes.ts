import type { Projects } from "./projects";

/** Saves project badge preferences shared by every device using this server. */
export class AppearanceRoutes {
	constructor(private readonly projects: Projects) {}

	/** PUT /api/projects/:slug/appearance; null restores the automatic badge color. */
	readonly save = async (request: Request): Promise<Response> => {
		const slug = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const body: unknown = await request.json().catch(() => null);
		const color =
			body !== null && typeof body === "object" && "color" in body
				? body.color
				: undefined;
		await this.projects.appearance(slug, color);
		return Response.json({});
	};
}
