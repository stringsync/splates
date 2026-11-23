import type { Conversation } from "../conversations";
import { fail } from "../exit";
import { fileResponse, refuse } from "../server/shared";
import { CAPTURE_REPORT } from "./capture";
import { DIAGRAM_REQUEST } from "./diagrams";
import { viewerOf } from "./viewers";

/**
 * Serves one version of an artifact of `conversation`, from `/api/conversations/
 * <id>/artifacts/<name>/<version>`. A name or version it lacks is a 404
 * `not_found`, and one whose bytes were deleted a 404 `gone`, which the page
 * shows as a placeholder. Add `?select` to a page to have it report what the
 * person selects in it to the frame around it.
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
	const response = fileResponse(
		request,
		served(read, new URL(request.url).searchParams.has("select")),
		read.mimeType,
		{
			// A version never changes, but its bytes can be deleted.
			"cache-control": "private, no-cache",
		},
	);
	response.headers.set(
		"content-security-policy",
		artifactPolicy(read.mimeType),
	);
	// A page that navigates itself away says nothing of where it was kept.
	response.headers.set("referrer-policy", "no-referrer");
	if (viewerOf(read.mimeType) === null) {
		response.headers.set(
			"content-disposition",
			`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
		);
	}
	return response;
}

/**
 * What a page framed for commenting runs besides its own: it tells its
 * frame's parent what the person has selected, as text and where it sits in
 * the frame, so the sheet can offer Comment. The page is sandboxed with no
 * origin, so it can only say this and never read the comments.
 */
const SELECTION_REPORT = `<script>(()=>{const t=()=>{const s=getSelection();const x=s&&s.rangeCount?s.toString().trim():"";let r=null;if(x){const b=s.getRangeAt(0).getBoundingClientRect();r={x:b.left,y:b.top,w:b.width,h:b.height}}parent.postMessage({splates:"selection",text:x.slice(0,2000),rect:r},"*")};document.addEventListener("selectionchange",()=>setTimeout(t,0));addEventListener("scroll",t,true)})()</script>`;

/**
 * The bytes sent for `read`: a page runs the diagram request at its end, and
 * with `selecting` the selection and capture reports too; anything else is
 * sent as kept.
 */
function served(
	read: { bytes: Uint8Array; mimeType: string },
	selecting: boolean,
): Uint8Array {
	if (!/^text\/html\b/i.test(read.mimeType)) {
		return read.bytes;
	}
	return withScripts(
		read.bytes,
		selecting
			? DIAGRAM_REQUEST + SELECTION_REPORT + CAPTURE_REPORT
			: DIAGRAM_REQUEST,
	);
}

/** `bytes`, a page, with `scripts` run at its end. */
function withScripts(
	bytes: Uint8Array,
	scripts: string,
): Uint8Array<ArrayBuffer> {
	const html = new TextDecoder().decode(bytes);
	const at = html.toLowerCase().lastIndexOf("</body>");
	const out =
		at === -1 ? html + scripts : html.slice(0, at) + scripts + html.slice(at);
	return new TextEncoder().encode(out);
}

/**
 * The policy an artifact is served under. An agent wrote it, and a page or
 * image of it runs in the person's browser, so it gets no origin of its own
 * to speak from: `sandbox` without `allow-same-origin` keeps its requests
 * from carrying the page's cookies, and `connect-src 'none'` keeps them from
 * the splates server API at all. Only the viewer's own page may frame it. Anything
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

/**
 * Deletes the bytes of the version that `request` names, `/api/conversations/
 * <id>/artifacts/<name>/<version>`, from `conversation`, keeping its record
 * so the page shows a placeholder.
 */
export async function deleteVersion(
	request: Request,
	conversation: Conversation,
): Promise<Response> {
	const parts = new URL(request.url).pathname.split("/");
	const name = decodeURIComponent(parts[5] ?? "");
	const version = Number(parts[6]);
	if (!Number.isInteger(version)) {
		fail("usage", `'${parts[6]}' is no artifact version`);
	}
	await conversation.artifacts.delete(name, version, "deleted");
	return Response.json({ deleted: name, version });
}

/**
 * Adds a version to `conversation`'s artifacts, for `splates artifact add`: a
 * form with the artifact's `name`, its `mimeType`, and its bytes as `file`.
 * The page hears of it as it would of any change.
 */
export async function addVersion(
	request: Request,
	conversation: Conversation,
): Promise<Response> {
	const form = await request.formData();
	const file = form.get("file");
	if (!(file instanceof File)) {
		fail("usage", "an artifact needs its file");
	}
	const version = await conversation.artifacts.add({
		name: String(form.get("name") ?? ""),
		mimeType: String(form.get("mimeType") ?? "application/octet-stream"),
		bytes: new Uint8Array(await file.arrayBuffer()),
	});
	return Response.json(version);
}

/** The agent's own `splates artifact remove`, `/api/conversations/<id>/artifacts/<name>`. */
export async function removeNamed(
	request: Request,
	conversation: Conversation,
): Promise<Response> {
	const name = decodeURIComponent(
		new URL(request.url).pathname.split("/")[5] ?? "",
	);
	await conversation.artifacts.remove(name);
	return Response.json({ removed: name });
}
