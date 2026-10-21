import { expect, test } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { infraInit } from "./init";

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
	expect(todo).toContain("pulumi config set --secret github:token");
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
