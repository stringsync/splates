import { expect, test } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { importEnvironment, infraInit } from "./init";

const options = (fs: FakeFs) => ({
	dir: "/p",
	stack: "prod",
	host: "splates.example.com",
	email: "me@example.com",
	region: "us-east-1",
	projects: [{ slug: "app", repository: "me/app" }],
	fs,
});

test("writes the program and the stack's config, naming what is left to set", async () => {
	const fs = new FakeFs();
	const { written, todo } = await infraInit(options(fs));
	expect(written).toEqual(["Pulumi.yaml", "index.ts", "Pulumi.prod.yaml"]);
	expect(await fs.read("/p/index.ts")).toContain("new CoordinatorBox");
	expect(await fs.read("/p/Pulumi.prod.yaml")).toContain("splates:host");
	expect(todo).toContain("pulumi config set --secret splates:githubToken-me");
});

test("names a GitHub token to set for each owner the projects are under, once", async () => {
	const fs = new FakeFs();
	const { secrets } = await infraInit({
		...options(fs),
		projects: [
			{ slug: "a", repository: "one/a" },
			{ slug: "b", repository: "two/b" },
			{ slug: "c", repository: "one/c" },
		],
	});
	expect(secrets).toEqual([
		"cloudflare:apiToken",
		"splates:githubToken-one",
		"splates:githubToken-two",
		"splates:anthropicKey",
	]);
});

test("run again, it writes nothing and keeps what the user changed", async () => {
	const fs = new FakeFs();
	await infraInit(options(fs));
	const stack = (await fs.read("/p/Pulumi.prod.yaml")).replace(
		"us-east-1",
		"eu-west-1",
	);
	await fs.write("/p/Pulumi.prod.yaml", stack);
	const again = await infraInit(options(fs));
	expect(again.written).toEqual([]);
	expect(await fs.read("/p/Pulumi.prod.yaml")).toContain("eu-west-1");
});

test("has the stack import the ESC environment it is given, once", async () => {
	const fs = new FakeFs();
	await infraInit({ ...options(fs), environment: "splates/aws" });
	await infraInit({ ...options(fs), environment: "splates/aws" });
	const stack = Bun.YAML.parse(await fs.read("/p/Pulumi.prod.yaml")) as {
		environment: string[];
		config: Record<string, unknown>;
	};
	expect(stack.environment).toEqual(["splates/aws"]);
	expect(stack.config["splates:host"]).toBe("splates.example.com");
});

test("imports an environment into a stack written already, keeping the rest", async () => {
	const fs = new FakeFs();
	await infraInit(options(fs));
	await fs.write(
		"/p/Pulumi.prod.yaml",
		`${await fs.read("/p/Pulumi.prod.yaml")}environment:\n  - me/other\n`,
	);
	expect(
		await importEnvironment(fs, "/p/Pulumi.prod.yaml", "splates/aws"),
	).toBe(true);
	expect(
		await importEnvironment(fs, "/p/Pulumi.prod.yaml", "splates/aws"),
	).toBe(false);
	const text = await fs.read("/p/Pulumi.prod.yaml");
	expect(Bun.YAML.parse(text)).toMatchObject({
		environment: ["me/other", "splates/aws"],
		config: { "aws:region": "us-east-1" },
	});
});

test("writes the program as packages/infra keeps it, formatted, so fix leaves a rerun nothing to rewrite", async () => {
	const fs = new FakeFs();
	await infraInit(options(fs));
	const kept = await Bun.file(
		new URL("../../infra/index.ts", import.meta.url),
	).text();
	expect(await fs.read("/p/index.ts")).toBe(kept);
});
