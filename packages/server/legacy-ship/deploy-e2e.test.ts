import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { eventually, json, serving } from "../server/testing";
import { Testing } from "../testing";

/**
 * A deploy target shipped through the real server's routes, in a real
 * repository with a real origin: its ship command serves a JSON plan and status, so a break anywhere from the graph to the live check fails here
 * where unit tests with fakes would not.
 */
describe("a deploy ship through the server", () => {
	let deps: Testing;
	let deployed: string;

	beforeEach(async () => {
		deps = await Testing.open();
		deployed = join(deps.root, "..", "deployed-commit");
		const { root } = deps;
		const origin = join(root, "..", "origin.git");
		await deps.gitCli(root, "init", "--bare", "-b", "main", origin);
		await deps.gitCli(root, "remote", "add", "origin", origin);
		await deps.fs.write(
			join(root, "deploy.ts"),
			`
const {execSync} = await import("node:child_process");
const commit = execSync("git rev-parse HEAD").toString().trim();
const identity = {kind: "commit", commit: commit};
if (process.argv.includes("plan")) console.log(JSON.stringify({schema: 1, identity, paths: ["apps/stage"], resuming: false, inputs: [], steps: []}));
else if (process.argv.includes("status")) console.log(JSON.stringify({identity, artifacts: [{name: "app", deployed: await Bun.file("${deployed}").exists() ? (await Bun.file("${deployed}").text()).trim() : null}]}));
else await Bun.write("${deployed}", commit);
`,
		);
		const ships = { stage: { ship: "bun deploy.ts" } };
		Object.assign(deps.config, { legacyShips: ships });
		await deps.fs.write(
			join(root, "package.json"),
			JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
		);
		await deps.fs.write(
			join(root, "splates.config.ts"),
			`export default ${JSON.stringify({ ships })};\n`,
		);
		await deps.fs.mkdir(join(root, "apps", "stage"), { recursive: true });
		await deps.fs.write(
			join(root, "apps", "stage", "package.json"),
			JSON.stringify({ name: "stage-app", version: "0.0.0", private: true }),
		);
		await deps.gitCli(root, "add", ".");
		await deps.gitCli(root, "commit", "-m", "a deploy target");
		await deps.gitCli(root, "push", "origin", "main");
	});

	afterEach(() => deps.disposeAsync());

	async function shipped(port: number): Promise<{
		status: string;
		steps: { slug: string; stages: { key: string; state: string }[] }[];
	}> {
		const response = await fetch(
			`http://127.0.0.1:${port}/api/legacy-ship/steps`,
		);
		return (await response.json()) as never;
	}

	async function unshipped(port: number): Promise<number | null> {
		const graph = (await (
			await fetch(`http://127.0.0.1:${port}/api/legacy-ship/graph`)
		).json()) as {
			projects: { slug: string; changes?: { commits: number | null } }[];
		};
		return (
			graph.projects.find((each) => each.slug === "stage")?.changes?.commits ??
			null
		);
	}

	async function ship(port: number): Promise<void> {
		const started = await json(port, "/api/legacy-ship/steps", "POST", {
			projects: [{ slug: "stage", bump: "patch" }],
		});
		expect(started.status).toBe(201);
		expect(
			await eventually(
				async () => ["done", "stopped"].includes((await shipped(port)).status),
				30_000,
			),
		).toBe(true);
	}

	it("waits for No through the answer route, then retries and continues on Yes", async () => {
		const script = join(deps.root, "ask.ts");
		await deps.fs.write(
			script,
			`
const identity = {kind: "commit", commit: "asked-commit"};
if (process.argv.includes("plan")) console.log(JSON.stringify({schema: 1, identity, paths: ["apps/stage"], resuming: false, inputs: [], steps: [{id: "deploy", name: "Deploy", stage: "publish", packages: [], deadlineMs: 60000}]}));
else if (process.argv.includes("status")) console.log(JSON.stringify({identity, artifacts: [{name: "app", deployed: await Bun.file("${deployed}").exists() ? "asked-commit" : null}]}));
else {
 const event = (type, extra = {}) => JSON.stringify({schema: 1, type, id: "deploy", name: "Deploy", at: new Date().toISOString(), ...extra}) + "\\n";
 const path = process.env.SPLATES_SHIP_EVENTS;
 const q = crypto.randomUUID();
 await Bun.write(path, event("declared", {stage: "publish", packages: [], deadlineMs: 60000}) + event("started") + event("ask", {questionId: q, question: "Deploy to production?"}));
 for (;;) {
 const answers = (await Bun.file(process.env.SPLATES_SHIP_ANSWERS).text()).trim().split("\\n").filter(Boolean).map(JSON.parse);
 const answer = answers.find(a => a.questionId === q);
 if (answer) {
 await Bun.write(path, await Bun.file(path).text() + event("answered", answer) + event(answer.answer ? "done" : "failed", {error: "declined"}));
 if (answer.answer) await Bun.write("${deployed}", identity.commit);
 process.exit(answer.answer ? 0 : 1);
 }
 await Bun.sleep(20);
 }
}
`,
		);
		const ships = { stage: { ship: "bun ask.ts" } };
		Object.assign(deps.config, { legacyShips: ships });
		await deps.fs.write(
			join(deps.root, "splates.config.ts"),
			`export default ${JSON.stringify({ ships })};`,
		);
		await serving(deps, async (_, port) => {
			expect(
				(
					await json(port, "/api/legacy-ship/steps", "POST", {
						projects: [{ slug: "stage", bump: "patch" }],
					})
				).status,
			).toBe(201);

			{
				expect(
					await eventually(
						async () =>
							(await shipped(port)).steps[0]?.stages.some(
								(stage) => stage.state === "asking",
							) === true,
						30000,
					),
				).toBe(true);
				const shown = await (
					await fetch(`http://127.0.0.1:${port}/api/legacy-ship/steps`)
				).json();
				const step = shown.steps[0];
				const question = step.stages[0].releaseSteps[0].question;
				expect(question.question).toBe("Deploy to production?");
				expect(
					(
						await json(port, "/api/legacy-ship/steps/answer", "POST", {
							id: shown.id,
							project: "stage",
							started: step.ship,
							questionId: question.questionId,
							answer: false,
						})
					).status,
				).toBe(200);
				expect(
					await eventually(
						async () => (await shipped(port)).status === "stopped",
						30000,
					),
				).toBe(true);
				expect(
					(await json(port, "/api/legacy-ship/steps/retry", "POST", {})).status,
				).toBe(200);
			}
			{
				expect(
					await eventually(
						async () =>
							(await shipped(port)).steps[0]?.stages.some(
								(stage) => stage.state === "asking",
							) === true,
						30000,
					),
				).toBe(true);
				const shown = await (
					await fetch(`http://127.0.0.1:${port}/api/legacy-ship/steps`)
				).json();
				const step = shown.steps[0];
				const question = step.stages[0].releaseSteps[0].question;
				expect(question.question).toBe("Deploy to production?");
				expect(
					(
						await json(port, "/api/legacy-ship/steps/answer", "POST", {
							id: shown.id,
							project: "stage",
							started: step.ship,
							questionId: question.questionId,
							answer: true,
						})
					).status,
				).toBe(200);
				expect(
					await eventually(
						async () => (await shipped(port)).status === "done",
						30000,
					),
				).toBe(true);
			}
		});
	});

	it("runs a planned private target, reports its failed step, and reruns the command", async () => {
		const script = join(deps.root, "planned.ts");
		await deps.fs.write(
			script,
			`
const identity = {kind: "commit", commit: "planned-commit"};
const artifact = Bun.file("${deployed}");
if (process.argv.includes("plan")) {
 console.log(JSON.stringify({schema: 1, identity, paths: ["apps/stage"], resuming: false, inputs: [], steps: [{id: "deploy", name: "Deploy private app", stage: "publish", packages: [], deadlineMs: 60000}]}));
} else if (process.argv.includes("status")) {
 console.log(JSON.stringify({identity, artifacts: [{name: "private-app", deployed: await artifact.exists() ? (await artifact.text()).trim() : null}]}));
} else {
 const event = (type, extra = {}) => JSON.stringify({schema: 1, type, id: "deploy", name: "Deploy private app", at: new Date().toISOString(), ...extra}) + "\\n";
 await Bun.write(process.env.SPLATES_SHIP_EVENTS, event("declared", {stage: "publish", packages: [], deadlineMs: 60000}) + event("started"));
 const attempts = Bun.file("attempts");
 const n = await attempts.exists() ? Number(await attempts.text()) : 0;
 await Bun.write("attempts", String(n + 1));
 if (n === 0) {
  await Bun.write(process.env.SPLATES_SHIP_EVENTS, await Bun.file(process.env.SPLATES_SHIP_EVENTS).text() + event("failed", {error: "deployment rejected"}));
  process.exit(1);
 }
 await Bun.write("${deployed}", identity.commit);
 await Bun.write(process.env.SPLATES_SHIP_EVENTS, await Bun.file(process.env.SPLATES_SHIP_EVENTS).text() + event("done"));
}
`,
		);
		const ships = { stage: { ship: "bun planned.ts" } };
		Object.assign(deps.config, { legacyShips: ships });
		await deps.fs.write(
			join(deps.root, "splates.config.ts"),
			`export default ${JSON.stringify({ ships })};`,
		);
		await serving(deps, async (_, port) => {
			await ship(port);
			const failed = await shipped(port);
			expect(failed.status).toBe("stopped");
			expect(failed.steps[0]).toMatchObject({
				to: "planned-commit",
				note: expect.stringContaining("deployment rejected"),
				stages: [
					{
						key: "publish",
						state: "failed",
						releaseSteps: [{ id: "deploy", state: "failed" }],
					},
					{ key: "live", state: "pending" },
				],
			});
			const retried = await json(
				port,
				"/api/legacy-ship/steps/retry",
				"POST",
				{},
			);
			expect(retried.status).toBe(200);
			expect(
				await eventually(
					async () => (await shipped(port)).status === "done",
					30000,
				),
			).toBe(true);
			expect(await deps.fs.read(join(deps.root, "attempts"))).toBe("2");
			expect(await deps.fs.read(deployed)).toBe("planned-commit");
		});
	});

	it("ships a never-deployed target from selection to done and reads it live", async () => {
		await serving(deps, async (_, port) => {
			expect(await unshipped(port)).toBeGreaterThan(0);

			await ship(port);

			const run = await shipped(port);
			expect(run.status).toBe("done");
			expect(run.steps[0]).toMatchObject({
				slug: "stage",
				stages: expect.arrayContaining([
					expect.objectContaining({ key: "publish", state: "done" }),
					expect.objectContaining({ key: "live", state: "skipped" }),
				]),
			});
			const head = await deps.gitCli(deps.root, "rev-parse", "HEAD");
			expect((await deps.fs.read(deployed)).trim()).toBe(head);
			expect(await unshipped(port)).toBe(0);
		});
	});

	it("ships only what landed since the commit it last deployed", async () => {
		await serving(deps, async (_, port) => {
			await ship(port);
			await deps.commit(
				deps.root,
				"unrelated.txt",
				"other\n",
				"an unrelated change",
			);
			expect(await unshipped(port)).toBe(0);
			await deps.commit(deps.root, "apps/stage/page.txt", "new\n", "a change");
			await deps.gitCli(deps.root, "push", "origin", "main");
			expect(await unshipped(port)).toBe(1);

			await ship(port);

			expect((await shipped(port)).status).toBe("done");
			const head = await deps.gitCli(deps.root, "rev-parse", "HEAD");
			expect((await deps.fs.read(deployed)).trim()).toBe(head);
			expect(await unshipped(port)).toBe(0);
		});
	});
});
