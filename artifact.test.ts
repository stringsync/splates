import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	addArtifact,
	listArtifacts,
	mimeTypeOf,
	removeArtifact,
} from "./artifact";
import { conversationOf } from "./conversation-given";
import { Testing } from "./testing";

describe("artifact", () => {
	let deps: Testing;
	const ID = "c1";

	beforeEach(async () => {
		deps = await Testing.open();
		const log = deps.service.conversationLog(ID);
		await deps.fs.mkdir(join(log, ".."));
		await deps.fs.write(
			log,
			`${JSON.stringify({ kind: "start", id: ID, agent: "fake", task: null, createdAt: "2026-10-16T10:00:00Z" })}\n`,
		);
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
		deps.proc.env.ARBOR_DEV = "http://dev";
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
		deps.proc.env.ARBOR_DEV = "http://dev";
		const send = async () => {
			throw new Error("refused");
		};

		const added = await addArtifact({ ...deps, send }, ID, {
			name: "a.png",
			bytes: bytes("x"),
		});

		expect(added.version).toBe(1);
	});

	it("needs a conversation of this repository", async () => {
		await expect(conversationOf(deps.service, "")).toBail("usage");
		await expect(conversationOf(deps.service, "nope")).toBail("not_found");
		expect(await conversationOf(deps.service, ID)).toBe(ID);
		deps.proc.env.ARBOR_CONVERSATION = ID;
		expect(await conversationOf(deps.service, "")).toBe(ID);
	});
});
