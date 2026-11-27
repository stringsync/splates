import { describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import {
	capturedFileName,
	findInlineMedia,
	ownsConversationAttached,
	readValidatedMedia,
	rewriteInlineMedia,
	validateMedia,
} from "./media";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF89 = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
const GIF87 = new TextEncoder().encode("GIF87a\x01\x00\x01\x00");
const WEBP = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86]);
const MP4 = new Uint8Array([
	0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00,
	0x00, 0x00, 0x00,
]);
const MOV_LEGACY = new Uint8Array([
	0x00, 0x00, 0x00, 0x08, 0x6d, 0x6f, 0x6f, 0x76,
]);
const SVG = new TextEncoder().encode(
	'<?xml version="1.0"?><!-- icon --><svg xmlns="http://www.w3.org/2000/svg"></svg>',
);

describe("validateMedia", () => {
	it("accepts every supported image and video format with matching magic bytes", () => {
		expect(validateMedia("/a/shot.png", PNG)).toEqual({
			ext: "png",
			mimeType: "image/png",
		});
		expect(validateMedia("/a/photo.JPG", JPG)).toEqual({
			ext: "jpg",
			mimeType: "image/jpeg",
		});
		expect(validateMedia("/a/photo.jpeg", JPG)).toEqual({
			ext: "jpeg",
			mimeType: "image/jpeg",
		});
		expect(validateMedia("/a/anim.gif", GIF89)).toEqual({
			ext: "gif",
			mimeType: "image/gif",
		});
		expect(validateMedia("/a/old.gif", GIF87)).toEqual({
			ext: "gif",
			mimeType: "image/gif",
		});
		expect(validateMedia("/a/pic.webp", WEBP)).toEqual({
			ext: "webp",
			mimeType: "image/webp",
		});
		expect(validateMedia("/a/icon.svg", SVG)).toEqual({
			ext: "svg",
			mimeType: "image/svg+xml",
		});
		expect(validateMedia("/a/clip.mp4", MP4)).toEqual({
			ext: "mp4",
			mimeType: "video/mp4",
		});
		expect(validateMedia("/a/clip.webm", WEBM)).toEqual({
			ext: "webm",
			mimeType: "video/webm",
		});
		expect(validateMedia("/a/clip.mov", MP4)).toEqual({
			ext: "mov",
			mimeType: "video/quicktime",
		});
		expect(validateMedia("/a/legacy.mov", MOV_LEGACY)).toEqual({
			ext: "mov",
			mimeType: "video/quicktime",
		});
	});

	it("rejects empty files, non-media extensions, mismatched signatures, and renamed text/secrets", () => {
		const secret = new TextEncoder().encode("API_KEY=super-secret-value\n");
		const htmlWithSvg = new TextEncoder().encode(
			"<!DOCTYPE html><html><body><svg></svg></body></html>",
		);
		const fakeMp4Text = new TextEncoder().encode("AAAAftypisomXXXX");
		const nulSvg = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x00, 0x3e]);

		expect(validateMedia("/a/empty.png", new Uint8Array())).toBeNull();
		expect(validateMedia("/a/.env", secret)).toBeNull();
		expect(validateMedia("/a/secret.txt", secret)).toBeNull();
		expect(validateMedia("/a/secret.png", secret)).toBeNull();
		expect(validateMedia("/a/secret.jpg", secret)).toBeNull();
		expect(validateMedia("/a/secret.gif", secret)).toBeNull();
		expect(validateMedia("/a/secret.webp", secret)).toBeNull();
		expect(validateMedia("/a/secret.svg", secret)).toBeNull();
		expect(validateMedia("/a/secret.mp4", fakeMp4Text)).toBeNull();
		expect(validateMedia("/a/secret.webm", secret)).toBeNull();
		expect(validateMedia("/a/secret.mov", secret)).toBeNull();
		expect(validateMedia("/a/page.svg", htmlWithSvg)).toBeNull();
		expect(validateMedia("/a/nul.svg", nulSvg)).toBeNull();
		// Extension and content must agree.
		expect(validateMedia("/a/wrong.jpg", PNG)).toBeNull();
		expect(validateMedia("/a/wrong.png", JPG)).toBeNull();
	});
});

describe("readValidatedMedia", () => {
	it("enforces file existence, regular file, size cap, and content validation", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/tmp/dir.png");
		await fs.writeBytes("/tmp/good.png", PNG);
		await fs.writeBytes("/tmp/fake.png", new TextEncoder().encode("not a png"));

		expect(await readValidatedMedia(fs, "/tmp/good.png", 100)).toMatchObject({
			ext: "png",
			mimeType: "image/png",
		});
		expect(await readValidatedMedia(fs, "/tmp/good.png", 4)).toBeNull();
		expect(await readValidatedMedia(fs, "/tmp/fake.png", 100)).toBeNull();
		expect(await readValidatedMedia(fs, "/tmp/dir.png", 100)).toBeNull();
		expect(await readValidatedMedia(fs, "/tmp/missing.png", 100)).toBeNull();
	});
});

describe("findInlineMedia and rewriteInlineMedia", () => {
	it("detects absolute, file://, and relative paths while skipping code blocks and remote URLs", () => {
		const md = [
			'See ![abs](/tmp/one.png) and ![url](file:///tmp/my%20two.webm) and ![rel](./shots/three.svg "title").',
			"Angled ![angled](</tmp/my (four).jpg>)",
			"Remote ![remote](https://example.com/a.png) and ![txt](/etc/passwd)",
			"Inline code `![in-code](/tmp/code.png)` stays untouched.",
			"```markdown",
			"![fenced](/tmp/fenced.png)",
			"```",
			"~~~",
			"![tilde](/tmp/tilde.png)",
			"~~~",
		].join("\n");

		const refs = findInlineMedia(md, "/work/tree");
		expect(refs).toEqual([
			{ raw: "/tmp/one.png", resolved: "/tmp/one.png", ext: "png" },
			{
				raw: "file:///tmp/my%20two.webm",
				resolved: "/tmp/my two.webm",
				ext: "webm",
			},
			{
				raw: "./shots/three.svg",
				resolved: "/work/tree/shots/three.svg",
				ext: "svg",
			},
			{
				raw: "/tmp/my (four).jpg",
				resolved: "/tmp/my (four).jpg",
				ext: "jpg",
			},
		]);

		const rewritten = rewriteInlineMedia(
			md,
			new Map([
				["/tmp/one.png", "/state/one.png"],
				["file:///tmp/my%20two.webm", "/state/two.webm"],
				["./shots/three.svg", "/state/three.svg"],
				["/tmp/my (four).jpg", "/state/four.jpg"],
				["/tmp/code.png", "/state/should-not-change.png"],
				["/tmp/fenced.png", "/state/should-not-change.png"],
			]),
		);

		expect(rewritten).toContain("![abs](/state/one.png)");
		expect(rewritten).toContain("![url](/state/two.webm)");
		expect(rewritten).toContain('![rel](/state/three.svg "title")');
		expect(rewritten).toContain("![angled](</state/four.jpg>)");
		expect(rewritten).toContain("`![in-code](/tmp/code.png)`");
		expect(rewritten).toContain("![fenced](/tmp/fenced.png)");
		expect(rewritten).toContain("![tilde](/tmp/tilde.png)");
	});

	it("holds back matches after an unclosed inline backtick while streaming", () => {
		const partial = "Use `![demo](/tmp/a.png)";
		expect(findInlineMedia(partial, null, { streaming: true })).toEqual([]);
		expect(findInlineMedia(partial, null, { streaming: false })).toHaveLength(
			1,
		);
	});

	it("checks conversation attachment ownership strictly", () => {
		expect(
			ownsConversationAttached(
				"/repo/.git/splates/conversations",
				"/repo/.git/splates/conversations/c1/attached/alpha/a.png",
			),
		).toBe(true);
		expect(
			ownsConversationAttached(
				"/repo/.git/splates/conversations",
				"/repo/.git/splates/conversations/c1/artifacts/a.png",
			),
		).toBe(false);
		expect(
			ownsConversationAttached(
				"/repo/.git/splates/conversations",
				"/repo/.git/splates/conversations/c1/attached/../../etc/passwd",
			),
		).toBe(false);
		expect(capturedFileName(PNG, "/tmp/my shot!.png")).toMatch(
			/^[0-9a-f]{16}-my-shot-.png$/,
		);
	});
});
