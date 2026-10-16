import type { Conversation } from "./conversation";
import { fileResponse, refuse } from "./dev-http";

/**
 * The version of an artifact that `request` names, `/api/conversations/<id>/
 * artifacts/<name>/<version>`, from `conversation`: 404 `not_found` for a
 * name or version its record lacks, and 404 `gone` for one whose bytes were
 * deleted, so the page shows a placeholder for it.
 */
export async function artifactResponse(
	request: Request,
	conversation: Conversation,
): Promise<Response> {
	const parts = new URL(request.url).pathname.split("/");
	const name = decodeURIComponent(parts[5] ?? "");
	const number = Number(parts[6]);
	const version = conversation.state.artifacts
		.find((each) => each.name === name)
		?.versions.find((each) => each.version === number);
	if (version === undefined) {
		return refuse(
			404,
			"not_found",
			`conversation ${conversation.id} holds no version ${parts[6]} of artifact ${name}`,
		);
	}
	const read =
		version.gone === null
			? await conversation.artifacts.read(name, number)
			: null;
	if (read === null) {
		return refuse(
			404,
			"gone",
			`version ${number} of artifact ${name} is gone: ${version.gone?.why ?? "its file is missing"}`,
		);
	}
	const response = fileResponse(request, read.bytes, read.mimeType, {
		// A version never changes, but its bytes can be deleted.
		"cache-control": "private, no-cache",
	});
	response.headers.set(
		"content-security-policy",
		artifactPolicy(read.mimeType),
	);
	return response;
}

/**
 * The policy an artifact is served under. An agent wrote it, and a page or
 * image of it runs in the person's browser, so it gets no origin of its own
 * to speak from: `sandbox` without `allow-same-origin` keeps its requests
 * from carrying the page's cookies, and `connect-src 'none'` keeps them from
 * the arbor dev API at all. Only the viewer's own page may frame it. Anything
 * but a page is served as `fileResponse` would, which runs nothing.
 */
function artifactPolicy(mimeType: string): string {
	const page = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml)\b/i.test(
		mimeType,
	);
	return page
		? "sandbox allow-scripts; default-src data: 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
		: "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'";
}
