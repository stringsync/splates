import { describe, expect, it } from "bun:test";
import { linkNamed, namedIn } from "./mentioned";

const named = {
	systems: [{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] }],
	projects: [
		{ slug: "shop", root: "/Users/me/shop" },
		{ slug: "playback", root: "/Users/me/playback" },
	],
	paths: new Set(["src/", "src/a.ts", "lib/a.ts", "app/(shop)/[id]/page.tsx"]),
	tree: "/repo",
};

describe("linkNamed", () => {
	it("links a system by its name or an alias, and a file in the tree", () => {
		expect(linkNamed("fix #player in @src/a.ts", named)).toBe(
			"fix [#player](#system=playback) in [@src/a.ts](#file=src%2Fa.ts&name=a.ts)",
		);
	});

	it("links a project by its slug, and a system over a project of its name", () => {
		const linked = linkNamed("match #shop, then #playback", named);
		const href = /\]\((#project=[^)]*)\)/.exec(linked)?.[1];

		expect(linked).toBe(
			"match [#shop](#project=shop), then [#playback](#system=playback)",
		);
		expect(namedIn(href)).toEqual({ project: "shop" });
	});

	it("leaves what a sentence puts after a mention outside it", () => {
		expect(linkNamed("see @src/a.ts. And #playback!", named)).toBe(
			"see [@src/a.ts](#file=src%2Fa.ts&name=a.ts). And [#playback](#system=playback)!",
		);
	});

	it("names files that share a name by the directories above them", () => {
		expect(linkNamed("@src/a.ts and @lib/a.ts", named)).toBe(
			"[@src/a.ts](#file=src%2Fa.ts&name=src%2Fa.ts) and [@lib/a.ts](#file=lib%2Fa.ts&name=lib%2Fa.ts)",
		);
	});

	it("links a directory, with its slash or without", () => {
		expect(linkNamed("@src/ and @src", named)).toBe(
			"[@src/](#file=src%2F&name=src%2F) and [@src](#file=src%2F&name=src%2F)",
		);
	});

	it("leaves alone a mention that names nothing, and code", () => {
		const text = "#12 #mixer @lib/ @src/b.ts mail@src/a.ts `@src/a.ts`";
		expect(linkNamed(text, named)).toBe(text);
	});

	it("reads back a path a link could not hold as typed", () => {
		const linked = linkNamed("@app/(shop)/[id]/page.tsx", named);
		const href = /\]\((#file=[^)]*)\)$/.exec(linked)?.[1];

		expect(linked.startsWith("[@app/(shop)/\\[id\\]/page.tsx]")).toBe(true);
		expect(namedIn(href)).toEqual({
			file: "app/(shop)/[id]/page.tsx",
			name: "page.tsx",
		});
	});

	it("links a UUID independently of its current name or presence in the roster", () => {
		const id = "550e8400-e29b-41d4-a716-446655440000";
		const linked = `see [#${id}](#conversations/${id}).`;
		expect(
			linkNamed(`see #${id}.`, {
				...named,
				conversations: [{ id, name: "Old name" }],
			}),
		).toBe(linked);
		expect(
			linkNamed(`see #${id}.`, {
				...named,
				conversations: [{ id, name: "New name" }],
			}),
		).toBe(linked);
		expect(linkNamed(`see #${id}.`, named)).toBe(linked);
		expect(namedIn(`#conversations/${id}`)).toEqual({ conversation: id });
		expect(namedIn("#conversations/new")).toBeNull();
		expect(namedIn("#conversations/archived")).toBeNull();
		expect(linkNamed(`\`#${id}\``, named)).toBe(`\`#${id}\``);
	});
});
