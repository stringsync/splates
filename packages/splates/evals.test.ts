import { expect, it } from "bun:test";
import { splatesHome } from "@splates/server/models";
import { Testing } from "@splates/server/testing";
import { splates } from "./splates";

it("attaches remarks to a batch for the Evals page", async () => {
	await using env = await Testing.open();
	env.ps.cd(env.root);
	const deps = {
		log: env.log,
		fs: env.fs,
		ps: env.ps,
		assets: env.assets,
		secrets: env.secrets,
	};
	await env.fs.mkdir(`${env.root}/nightly`);
	await env.fs.write(`${env.root}/nightly/batch.json`, "{}");
	await env.fs.write(`${env.root}/remarks.md`, "Skill: too faint");

	await splates.run(deps, ["evals", "remarks", "nightly", "remarks.md"]);

	expect(await env.fs.read(`${env.root}/nightly/remarks.md`)).toBe(
		"Skill: too faint",
	);
});

it("prints each saved eval agent as its target, and says when none are saved", async () => {
	await using env = await Testing.open();
	env.ps.cd(env.root);
	const deps = {
		log: env.log,
		fs: env.fs,
		ps: env.ps,
		assets: env.assets,
		secrets: env.secrets,
	};
	const home = splatesHome(env.ps);

	await splates.run(deps, ["evals", "agents"]);
	expect(env.out()).toContain("no eval agents are saved");

	await env.fs.mkdir(home, { recursive: true });
	await env.fs.write(
		`${home}/eval-agents.json`,
		JSON.stringify({
			format: 1,
			agents: [
				{ agent: "claude", model: "m1", effort: "high" },
				{ agent: "codex" },
			],
		}),
	);
	await splates.run(deps, ["evals", "agents"]);
	expect(env.out()).toContain("claude:m1@high");
	expect(env.out()).toContain("codex");
});
