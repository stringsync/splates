import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { conversationOf } from "../conversations";
import { Testing } from "../testing";
import {
	addArtifact,
	listArtifacts,
	mimeTypeOf,
	removeArtifact,
} from "./artifact";

describe("artifact", () => {
	let deps: Testing;
	const ID = "c1";

	beforeEach(async () => {
		deps = await Testing.open();
		await deps.service.conversationLog(ID).append({
			kind: "start",
			id: ID,
			agent: "fake",
			task: null,
			createdAt: "2026-10-16T10:00:00Z",
		});
	});

	afterEach(() => deps.disposeAsync());

	const bytes = (text: string) => new TextEncoder().encode(text);

	it("guesses the media type from the extension", () => {
		expect(mimeTypeOf("page.HTML")).toBe("text/html");
		expect(mimeTypeOf("shot.png")).toBe("image/png");
		expect(mimeTypeOf("blob")).toBe("application/octet-stream");
	});

	it("makes the next version of a name it holds, and lists them", async () => {
		const first = await addArtifact(deps, ID, {
			name: "page.html",
			bytes: bytes("one"),
		});
		const second = await addArtifact(deps, ID, {
			name: "page.html",
			bytes: bytes("three"),
		});

		expect([first.version, second.version]).toEqual([1, 2]);
		await listArtifacts(deps, ID);
		expect(deps.out()).toContain("page.html  v2 of 2  text/html");
		await listArtifacts(deps, ID, "page.html");
		expect(deps.out()).toContain("v2 (current)");
	});

	it("removes an artifact, keeping its versions", async () => {
		await addArtifact(deps, ID, { name: "a.png", bytes: bytes("x") });

		expect(await removeArtifact(deps, ID, "a.png")).toBe(1);

		await listArtifacts(deps, ID);
		expect(deps.out()).toContain("holds 0 artifacts");
		await listArtifacts(deps, ID, "a.png");
		expect(deps.out()).toContain("a.png (removed)");
		await expect(removeArtifact(deps, ID, "a.png")).toBail("not_found");
		await expect(removeArtifact(deps, ID, "b.png")).toBail("not_found");
	});

	it("refuses a file past the limit, changing nothing", async () => {
		deps.config.artifactFileCapacity = 2;

		await expect(
			addArtifact(deps, ID, { name: "a.png", bytes: bytes("xyz") }),
		).toBail("too_large");

		await listArtifacts(deps, ID);
		expect(deps.out()).toContain("holds 0 artifacts");
	});

	it("goes through the server when one is in the env", async () => {
		deps.proc.env.SPLATES_DEV = "http://dev";
		const sent: string[] = [];
		const send = async (url: string) => {
			sent.push(url);
			return Response.json(
				{ reason: "too_large", message: "too big" },
				{ status: 413 },
			);
		};

		await expect(
			addArtifact({ ...deps, send }, ID, { name: "a.png", bytes: bytes("x") }),
		).toBail("too_large", { message: "too big" });
		expect(sent).toEqual(["http://dev/api/conversations/c1/artifacts"]);
	});

	it("falls back to the log when the server cannot be reached", async () => {
		deps.proc.env.SPLATES_DEV = "http://dev";
		const send = async () => {
			throw new Error("refused");
		};

		const added = await addArtifact({ ...deps, send }, ID, {
			name: "a.png",
			bytes: bytes("x"),
		});

		expect(added.version).toBe(1);
	});

	it("retries on a worker, then fails rather than keep it on disk", async () => {
		deps.proc.env.SPLATES_DEV = "http://dev";
		deps.proc.env.SPLATES_WORKER = "w1";
		let calls = 0;
		const send = async () => {
			calls++;
			throw new Error("refused");
		};

		await expect(
			addArtifact({ ...deps, send, retryMs: 0 }, ID, {
				name: "a.png",
				bytes: bytes("x"),
			}),
		).toBail("timeout");
		expect(calls).toBe(3);
		await listArtifacts(deps, ID);
		expect(await deps.service.conversationLog(ID).replay()).not.toBeNull();
	});

	it("succeeds on a worker once a retry reaches the server", async () => {
		deps.proc.env.SPLATES_DEV = "http://dev";
		deps.proc.env.SPLATES_WORKER = "w1";
		let calls = 0;
		const send = async () => {
			if (++calls < 2) {
				throw new Error("refused");
			}
			return Response.json({ version: 1, bytes: 1, mimeType: "image/png" });
		};

		const added = await addArtifact({ ...deps, send, retryMs: 0 }, ID, {
			name: "a.png",
			bytes: bytes("x"),
		});

		expect(added.version).toBe(1);
		expect(calls).toBe(2);
	});

	it("needs a conversation of this repository", async () => {
		await expect(conversationOf(deps.service, "")).toBail("usage");
		await expect(conversationOf(deps.service, "nope")).toBail("not_found");
		expect(await conversationOf(deps.service, ID)).toBe(ID);
		deps.proc.env.SPLATES_CONVERSATION = ID;
		expect(await conversationOf(deps.service, "")).toBe(ID);
	});
});
