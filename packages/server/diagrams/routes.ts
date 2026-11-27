import { fail } from "../exit";
import { type Handler, refuse } from "../server/shared";

/** Longest D2 source the server accepts for a single diagram render. */
export const MAX_D2_SOURCE = 50_000;

const VALID_SALT = /^[a-zA-Z0-9_-]{0,64}$/;

/** Compiles D2 source to SVG for `DiagramRoutes`. */
export interface DiagramRenderer {
	render(source: string, salt: string): Promise<string>;
}

/** HTTP handlers for `/api/d2`, rendering D2 diagrams to SVG on the server. */
export class DiagramRoutes {
	constructor(private readonly renderer: DiagramRenderer) {}

	/** `POST /api/d2`: compiles `{ source, salt? }` to `{ svg }`. */
	readonly render: Handler = async (request) => {
		const body = (await request.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (body === null || typeof body !== "object") {
			fail("usage", "request body must be a JSON object");
		}
		const source = body.source;
		if (typeof source !== "string" || source.trim() === "") {
			fail("usage", "source must be a non-empty string");
		}
		if (source.length > MAX_D2_SOURCE) {
			fail("usage", `source exceeds ${MAX_D2_SOURCE} characters`);
		}
		const rawSalt = body.salt;
		if (rawSalt !== undefined && typeof rawSalt !== "string") {
			fail("usage", "salt must be a string");
		}
		if (rawSalt !== undefined && !VALID_SALT.test(rawSalt)) {
			fail("usage", "salt must be at most 64 letters, digits, _ or -");
		}
		const salt =
			rawSalt !== undefined && rawSalt !== ""
				? rawSalt
				: Bun.hash(source).toString(36);
		try {
			const svg = await this.renderer.render(source, salt);
			return Response.json({ svg });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return refuse(422, "invalid_d2", message);
		}
	};
}
