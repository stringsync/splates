import { beforeEach, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { APP_ID, APP_KEY } from "../merge";
import { GITHUB_AREA } from "./area-github";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";
const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString();
const PUSH_RULES = [
	{ type: "creation" },
	{ type: "update" },
	{ type: "deletion" },
];

/** What the fake GitHub answers, by what it is asked. */
interface GitHub {
	permissions: Record<string, string>;
	installed: boolean;
	/** The rules on each branch; a branch not here has none. */
	rules: Record<string, { type: string }[]>;
	/** The tag rulesets, each with the rules it applies to every tag. */
	tagRulesets: { enforcement: string; rules: { type: string }[] }[];
}

describe("GITHUB_AREA", () => {
	let github: GitHub;
	let remote: string | null;
	let url: string | null;
	let machine: SetupMachine;

	beforeEach(async () => {
		github = {
			permissions: { contents: "write", metadata: "read" },
			installed: true,
			rules: {
				main: PUSH_RULES,
				"splates-probe/unnamed": PUSH_RULES,
			},
			tagRulesets: [{ enforcement: "active", rules: PUSH_RULES }],
		};
		remote = "origin";
		url = "git@github.com:o/r.git";
		machine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore(),
			fetch: (async (asked: string, init?: RequestInit) =>
				answer(github, asked, init?.method ?? "GET")) as typeof fetch,
			project: {
				root: "/repo",
				config: async () => ({
					trunk: "main",
					remote,
					replica: null,
					evals: null,
				}),
				remoteUrl: async (name) => (name === "origin" ? url : null),
			},
		};
		await machine.device.set(APP_ID, "42");
		await machine.device.set(APP_KEY, KEY);
	});

	async function steps() {
		const progress = await new Setup(machine, [GITHUB_AREA]).read();
		return Object.fromEntries(
			(progress.areas[0]?.steps ?? []).map((step) => [
				step.id,
				{ status: step.status, problem: step.problem },
			]),
		);
	}

	it("is done once the App is installed, the ruleset keeps it to splates/*, and pushing is on", async () => {
		expect(await steps()).toEqual({
			"github-app": { status: "done", problem: null },
			"github-install": { status: "done", problem: null },
			"github-ruleset": { status: "done", problem: null },
			"github-push": { status: "done", problem: null },
		});
	});

	it("starts at making the App while its creds are not kept", async () => {
		await machine.device.delete(APP_KEY);

		const found = await steps();

		expect(found["github-app"]?.status).toBe("ready");
		expect(found["github-install"]?.status).toBe("waiting");
	});

	it("links the App's install page while it is not installed", async () => {
		github.installed = false;

		expect((await steps())["github-install"]).toEqual({
			status: "ready",
			problem:
				"Not installed on o/r: install it from https://github.com/apps/splates-o/installations/new",
		});
	});

	it("leaves the ruleset to do while branches outside splates/* can be pushed", async () => {
		github.rules = { main: PUSH_RULES };

		expect((await steps())["github-ruleset"]).toEqual({
			status: "ready",
			problem: null,
		});
	});

	it("says a ruleset that covers splates/* too stops workers pushing", async () => {
		github.rules["splates/probe"] = PUSH_RULES;

		expect((await steps())["github-ruleset"]?.problem).toContain(
			"The ruleset covers `splates/*` too",
		);
	});

	it("leaves the ruleset to do while tags can be pushed", async () => {
		github.tagRulesets = [];

		expect((await steps())["github-ruleset"]?.status).toBe("ready");
	});

	it("does not count a tag ruleset that is not active or lacks a rule", async () => {
		github.tagRulesets = [
			{ enforcement: "evaluate", rules: PUSH_RULES },
			{ enforcement: "active", rules: [{ type: "deletion" }] },
		];

		expect((await steps())["github-ruleset"]?.status).toBe("ready");
	});

	it("leaves pushing to turn on while the config names no remote", async () => {
		remote = null;

		expect((await steps())["github-push"]?.status).toBe("ready");
	});

	it("says the remote is not on github.com", async () => {
		url = "git@gitlab.com:o/r.git";

		expect((await steps())["github-install"]?.problem).toBe(
			"`origin` is not on github.com, where the App pushes: git@gitlab.com:o/r.git",
		);
	});

	it("says there is no project to check outside one", async () => {
		delete machine.project;

		expect((await steps())["github-install"]?.problem).toContain(
			"No project to check",
		);
	});

	it("refuses an App that may do more than push contents", async () => {
		github.permissions = { ...github.permissions, administration: "write" };

		await expect(
			new Setup(machine, [GITHUB_AREA]).submit("github-app", {}),
		).rejects.toThrow(
			"The App may do more than push contents (administration)",
		);
	});

	it("plans deleting the installation, and leaves the App, its rulesets and the remote to the person", async () => {
		const plan = await new Setup(machine, [GITHUB_AREA]).undoPlan("github");

		expect(plan.steps).toEqual([
			{
				id: "github-push",
				title: "Turn pushing on",
				done: true,
				removes: [],
				leaves: [
					"`remote` stays in `splates.config.ts`: land a change that takes it out to stop pushing.",
				],
			},
			{
				id: "github-ruleset",
				title: "Keep the App to splates branches, and off tags",
				done: true,
				removes: [],
				leaves: [
					"The ruleset `splates-tags`: `gh api -X DELETE repos/o/r/rulesets/0`, or in https://github.com/o/r/settings/rules.",
					"The ruleset `splates`: `gh api -X DELETE repos/o/r/rulesets/100`, or in https://github.com/o/r/settings/rules.",
				],
			},
			{
				id: "github-install",
				title: "Install the App on this repository",
				done: true,
				removes: [
					"The App's installation on o/r, and with it every repository it was installed on",
				],
				leaves: [],
			},
			{
				id: "github-app",
				title: "Make the splates GitHub App",
				done: true,
				removes: [],
				leaves: [
					"The App itself: delete it at the foot of https://github.com/settings/apps/splates-o/advanced.",
				],
			},
		]);
		expect(plan.creds).toEqual([
			{ name: APP_ID, keptFor: null },
			{ name: APP_KEY, keptFor: null },
		]);
		expect(plan.refused).toBeNull();
	});

	it("deletes the installation with the App's creds still kept, then forgets them", async () => {
		const install = GITHUB_AREA.steps.find(
			(step) => step.id === "github-install",
		);

		await new Setup(machine, [GITHUB_AREA]).undo("github", null);

		expect(github.installed).toBe(false);
		expect(await machine.device.get(APP_KEY)).toBeUndefined();
		await machine.device.set(APP_ID, "42");
		await machine.device.set(APP_KEY, KEY);
		await expect(install?.check(machine)).rejects.toThrow("Not installed");
		// Again, with nothing left to delete.
		await install?.undo?.run(machine);
	});
});

/** The fake GitHub's answer to `method` on `url`. */
function answer(github: GitHub, url: string, method: string): Response {
	const path = new URL(url).pathname;
	if (method === "GET" && path === "/app") {
		return Response.json({
			slug: "splates-o",
			permissions: github.permissions,
		});
	}
	if (method === "GET" && path === "/repos/o/r/installation") {
		return github.installed
			? Response.json({ id: 7 })
			: new Response("Not Found", { status: 404 });
	}
	if (method === "POST" && path === "/app/installations/7/access_tokens") {
		return Response.json({
			token: "installation-token",
			expires_at: "2026-10-17T13:00:00Z",
		});
	}
	if (method === "DELETE" && path === "/app/installations/7") {
		if (!github.installed) {
			return new Response("Not Found", { status: 404 });
		}
		github.installed = false;
		return new Response(null, { status: 204 });
	}
	if (method === "GET" && path === "/repos/o/r/rulesets") {
		return Response.json([
			...github.tagRulesets.map((each, id) => ({
				id,
				name: "splates-tags",
				target: "tag",
				enforcement: each.enforcement,
			})),
			{ id: 100, name: "splates", target: "branch", enforcement: "active" },
			{ id: 101, name: "theirs", target: "branch", enforcement: "active" },
		]);
	}
	const ruleset = /^\/repos\/o\/r\/rulesets\/(\d+)$/.exec(path)?.[1];
	if (method === "GET" && ruleset !== undefined) {
		return Response.json({
			conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
			rules: github.tagRulesets[Number(ruleset)]?.rules,
		});
	}
	const branch = /^\/repos\/o\/r\/rules\/branches\/(.+)$/.exec(path)?.[1];
	if (method === "GET" && branch !== undefined) {
		return Response.json(github.rules[decodeURIComponent(branch)] ?? []);
	}
	return new Response("Not Found", { status: 404 });
}
