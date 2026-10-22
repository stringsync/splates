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

test("writes the program and the stack's config, with no secret in it", async () => {
	const fs = new FakeFs();
	const { written, todo } = await infraInit(options(fs));
	expect(written).toEqual([
		"Pulumi.yaml",
		"index.ts",
		".gitignore",
		"Pulumi.prod.yaml",
	]);
	expect(await fs.read("/p/index.ts")).toContain("new CoordinatorBox");
	expect(await fs.read("/p/Pulumi.prod.yaml")).toContain("splates:host");
	expect(todo.some((line) => line.includes("--secret"))).toBe(false);
	expect(await fs.read("/p/Pulumi.prod.yaml")).not.toContain("githubToken");
});

test("takes out a secret an older run set in the stack's config", async () => {
	const fs = new FakeFs();
	await fs.mkdir("/p", { recursive: true });
	await fs.write(
		"/p/Pulumi.prod.yaml",
		"config:\n  aws:region: us-west-2\n  cloudflare:apiToken:\n    secure: v1:x\n  splates:githubToken-me:\n    secure: v1:y\n",
	);
	await infraInit(options(fs));
	const text = await fs.read("/p/Pulumi.prod.yaml");
	expect(text).toContain("us-west-2");
	expect(text).not.toContain("secure");
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

test("keeps the stack's file out of git, as packages/infra does", async () => {
	const fs = new FakeFs();
	await infraInit(options(fs));
	const kept = await Bun.file(
		new URL("../../infra/.gitignore", import.meta.url),
	).text();
	expect(await fs.read("/p/.gitignore")).toBe(kept);
	expect(kept).toContain("Pulumi.*.yaml");
});
