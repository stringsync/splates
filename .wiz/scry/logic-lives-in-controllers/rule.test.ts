import { beforeEach, describe, expect, it } from "bun:test";
import { Cases, SourceFile } from "@webappwiz/scry";
import { FakeDecider } from "@webappwiz/scry/testing";
import LogicLivesInControllers from "./rule";

const cases = await Cases.load(import.meta.dir);

describe("logic-lives-in-controllers", () => {
	let som: FakeDecider;
	let rule: LogicLivesInControllers;

	beforeEach(() => {
		som = new FakeDecider({}, 0.8);
		rule = new LogicLivesInControllers({ som, llm: new FakeDecider() });
	});

	it.each(cases.bad)("flags $name when the som says yes", async ({ file }) => {
		expect(await rule.check(file)).not.toEqual([]);
	});

	it.each(cases.good)(
		"flags nothing in $name by code alone",
		async ({ file }) => {
			const findings = await rule.check(file);

			expect(findings.map(({ confidence }) => confidence)).not.toContain(1);
		},
	);

	it("flags a plain class that uses a framework's names, but not one that registers routes", async () => {
		const file = new SourceFile(
			"a.ts",
			[
				'import { Hono, HTTPException } from "hono";',
				"export class Todos {",
				"\tfind(id: string) {",
				"\t\tthrow new HTTPException(404);",
				"\t}",
				"}",
				"export class Server {",
				"\tapp = new Hono();",
				"\tconstructor(todos: Todos) {",
				'\t\tthis.app.get("/", (c) => c.json(todos.find("1")));',
				"\t}",
				"}",
			].join("\n"),
		);

		const findings = await rule.check(file);

		expect([
			som.asked,
			findings.map(({ line, message }) => [line, message]),
		]).toEqual([
			[],
			[
				[
					2,
					"Todos uses HTTPException from hono, so it cannot run without it: give it plain arguments and results, and leave hono to the adapter that calls it.",
				],
			],
		]);
	});

	it("asks about a component that holds state or branches in a handler, and passes one that does neither", async () => {
		const file = new SourceFile(
			"a.tsx",
			[
				"export function Counter() {",
				"\tconst [count, setCount] = useState(0);",
				"\treturn <p>{count}</p>;",
				"}",
				"export const Name = ({ user }: { user: User }) => <p>{user.name}</p>;",
				"export function Save({ draft }: { draft: Draft }) {",
				"\treturn <button onClick={() => { if (draft.ok) draft.save(); }} />;",
				"}",
			].join("\n"),
		);

		const findings = await rule.check(file);

		expect(findings.map(({ line, confidence }) => [line, confidence])).toEqual([
			[1, 0.8],
			[6, 0.8],
		]);
	});

	it("asks about a route or action only when it branches or runs a function of its own", async () => {
		const file = new SourceFile(
			"a.ts",
			[
				'import express from "express";',
				'import { cli } from "webappwiz/cmd";',
				'app.get("/a", (req, res) => res.json(service.a()));',
				'app.get("/b", (req, res) => res.json(rows.filter((row) => row.b)));',
				'cli("app").command("c").action((opts) => run(opts));',
				'cli("app").command("d").action((opts) => opts.all ? all() : one());',
			].join("\n"),
		);

		await rule.check(file);

		expect(som.asked.map(({ about }) => about.line)).toEqual([4, 6]);
	});

	it("points a chained route or action at the line that registers it, not where the chain starts", async () => {
		const file = new SourceFile(
			"a.ts",
			[
				'import { Hono } from "hono";',
				'import { cli } from "webappwiz/cmd";',
				"app",
				'\t.get("/a", (c) => c.json(service.a()))',
				'\t.get("/b", (c) => (c.req.query("all") ? all() : one()));',
				'cli("app")',
				'\t.command("c")',
				'\t.description("does c")',
				"\t.action((opts) => (opts.all ? all() : one()));",
			].join("\n"),
		);

		const findings = await rule.check(file);

		expect(findings.map(({ line }) => line)).toEqual([5, 9]);
	});

	it("asks about a function taking the web's Request only when it branches, and not about one taking a framework's", async () => {
		const plain = new SourceFile(
			"a.ts",
			[
				"const one = (request: Request) => Response.json(todos.list());",
				'const two = async (request: Request) => (request.method === "GET" ? list() : add());',
			].join("\n"),
		);
		const framed = new SourceFile(
			"b.ts",
			[
				'import type { Request } from "express";',
				"const three = (request: Request) => (request.query.all ? all() : one());",
			].join("\n"),
		);

		const findings = [
			...(await rule.check(plain)),
			...(await rule.check(framed)),
		];

		expect(findings.map(({ line, message }) => [line, message])).toEqual([
			[
				2,
				"two decides or computes itself: move that into a plain service with a method per route, and let the handler translate the request into one call and its result into the response.",
			],
		]);
	});

	it("reads no route or action in a file that imports no framework", async () => {
		const file = new SourceFile(
			"a.ts",
			'cache.get("/a", (key) => (key ? load(key) : undefined));',
		);

		await rule.check(file);

		expect(som.asked).toEqual([]);
	});
});
