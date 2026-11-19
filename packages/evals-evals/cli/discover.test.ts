import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintOf } from "../fingerprint";
import { cellsOf, pickOf, runId, select } from ".";
import { discover, problems } from "./discover";

// vet-ignore tests-own-their-state: This registry only cleans temporary directories; tests never read another test's fixtures.
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function project(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "evals-discover-"));
	roots.push(root);
	for (const [path, text] of Object.entries(files)) {
		const file = join(root, path);
		await mkdir(join(file, ".."), { recursive: true });
		await writeFile(file, text);
	}
	return root;
}

const SCENARIO = (id: string, extra = "") =>
	`export const scenarios = [{ id: "${id}", aspect: "${id.split("/")[0]}", requirement: "r", message: "m", judge: "j"${extra} }];`;

it("finds scenarios beside each skill, skipping tests and node_modules", async () => {
	const root = await project({
		"p/skills/a/evals/one.ts": SCENARIO("x/one"),
		"p/skills/a/evals/one.test.ts": "throw new Error('not loaded')",
		"p/skills/b/evals/two.ts": SCENARIO("y/two"),
		"p/node_modules/z/skills/c/evals/three.ts": SCENARIO("z/three"),
		"p/skills/a/SKILL.md": "",
	});
	const found = await discover(root);
	expect(found.map((each) => [each.skill, each.scenario.id])).toEqual([
		["a", "x/one"],
		["b", "y/two"],
	]);
	expect(found[0]?.dir).toBe(join(root, "p/skills/a"));
});

it("reports malformed scenarios", async () => {
	const root = await project({
		"p/skills/a/evals/one.ts": `export const scenarios = [
			{ id: "x/one", aspect: "x", requirement: "r", message: "m", judge: "j", judgeWith: "claude:sonnet" },
			{ id: "x/one", aspect: "x", requirement: " ", message: "m" },
			{ id: "bad", aspect: "x", requirement: "r", message: "m", judge: "j", judgeWith: "claude:sonnet" },
		];`,
	});
	const wrong = problems(await discover(root));
	expect(wrong).toHaveLength(4);
	expect(wrong.join("\n")).toContain("id also declared");
	expect(wrong.join("\n")).toContain("requirement is empty");
	expect(wrong.join("\n")).toContain("nothing can fail");
	expect(wrong.join("\n")).toContain("id should be x/<name>");
});

it("reports a scenario judge that is no Claude pick, or has no rubric", async () => {
	const root = await project({
		"p/skills/a/evals/one.ts": `export const scenarios = [
			{ id: "x/one", aspect: "x", requirement: "r", message: "m", judge: "j", judgeWith: "claude:opus@high" },
			{ id: "x/two", aspect: "x", requirement: "r", message: "m", judge: "j", judgeWith: "codex:gpt-5" },
			{ id: "x/three", aspect: "x", requirement: "r", message: "m", checks: [{ id: "c", about: "c", test: () => true }], judgeWith: "claude:opus" },
		];`,
	});
	const wrong = problems(await discover(root));
	expect(wrong).toEqual([
		expect.stringContaining("x/two: no judge codex:gpt-5"),
		expect.stringContaining(
			"x/three: judgeWith names a judge but there is no rubric",
		),
	]);
});

it("selects by skill and id and plans one cell per agent and repetition", async () => {
	const root = await project({
		"p/skills/a/evals/one.ts": SCENARIO("x/one"),
		"p/skills/b/evals/two.ts": SCENARIO("y/two"),
	});
	const found = await discover(root);
	expect(select(found, ["b"], [])).toHaveLength(1);
	expect(select(found, [], ["x/one"])).toHaveLength(1);
	expect(
		cellsOf(found, [pickOf("claude"), pickOf("codex:m@high")], 3),
	).toHaveLength(12);
	expect(pickOf("codex:m@high")).toEqual({
		agent: "codex",
		model: "m",
		effort: "high",
	});
	expect(() => pickOf("nope")).toThrow();
});

it("reads a run id in either form", () => {
	expect(runId(["b#run-003"])).toEqual({ batch: "b", run: "run-003" });
	expect(runId(["b", "3"])).toEqual({ batch: "b", run: "run-003" });
	expect(runId(["b"])).toBeNull();
});

// vet-ignore simple-test-setup: These two scenario modules are unique to the per-file factory test.
it("carries each file's sandbox into plan and run cells", async () => {
	const root = await project({
		"p/skills/a/evals/one.ts": `${SCENARIO("x/custom")}export const sandbox = async () => { throw new Error('only runs during execution'); };`,
		"p/skills/a/evals/two.ts": SCENARIO("x/plain"),
	});
	const found = await discover(root);
	const cells = cellsOf(found, [pickOf("claude")], 2);
	expect(
		cells.slice(0, 2).every((cell) => cell.sandbox === found[0]?.sandbox),
	).toBe(true);
	expect(typeof cells[0]?.sandbox).toBe("function");
	expect(cells.slice(2).every((cell) => cell.sandbox === undefined)).toBe(true);
});

it("fingerprints transitive helpers without invalidating unrelated scenarios", async () => {
	const root = await project({
		"p/skills/a/evals/one.ts":
			'import { check } from "./helper"; export const scenarios = [{id:"x/one", aspect:"x", requirement:"r", message:"m", checks:[{id:"c", about:"c", test:check}]}];',
		"p/skills/a/evals/helper.ts": 'export { check } from "./nested";',
		"p/skills/a/evals/nested.ts": "export const check = () => true;",
		"p/skills/b/evals/two.ts": SCENARIO("y/two"),
	});
	const hashes = async () =>
		(await discover(root)).map(({ scenario }) => fingerprintOf(scenario, "s"));
	const before = await hashes();
	await writeFile(
		join(root, "p/skills/a/evals/nested.ts"),
		"export const check = () => false;",
	);
	const after = await hashes();
	expect(after[0]).not.toBe(before[0]);
	expect(after[1]).toBe(before[1]);
	expect(await hashes()).toEqual(after);
});

it("reports a rubric scenario that names no judge", async () => {
	const root = await project({
		"p/skills/a/evals/one.ts": SCENARIO("x/one"),
	});
	expect(problems(await discover(root))).toEqual([
		expect.stringContaining("x/one: has a rubric but no judgeWith"),
	]);
});
