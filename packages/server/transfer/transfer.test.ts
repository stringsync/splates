import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { askAgain, exportBundle, importBundle, parseBundle } from "./index";

describe("config transfer", () => {
	let from: Testing;
	let to: Testing;

	beforeEach(async () => {
		from = await Testing.open();
		to = await Testing.open();
	});

	afterEach(async () => {
		await from.disposeAsync();
		await to.disposeAsync();
	});

	const places = (side: Testing) => ({
		fs: side.fs,
		storage: side.storage,
		home: side.splatesHome,
	});

	const put = (side: Testing, path: string, text: string) => {
		const at = path.lastIndexOf("/");
		return side.storage
			.collection(at < 0 ? "" : path.slice(0, at))
			.write(path.slice(at + 1), text);
	};

	const get = (side: Testing, path: string) => {
		const at = path.lastIndexOf("/");
		return side.storage
			.collection(at < 0 ? "" : path.slice(0, at))
			.read(path.slice(at + 1));
	};

	it("carries config, tasks and plans, never creds", async () => {
		await put(from, "plans/a.md", "plan");
		await put(from, "hooks.json", "{}");
		await put(from, "creds.json", "secret");
		await from.fs.mkdir(from.splatesHome, { recursive: true });
		await from.fs.write(`${from.splatesHome}/agents.json`, "{}");
		await from.fs.write(`${from.splatesHome}/offered.json`, "{}");
		await from.fs.write(`${from.splatesHome}/spend.jsonl`, "");

		const bundle = await exportBundle(places(from), []);
		expect(Object.keys(bundle.project).sort()).toEqual([
			"hooks.json",
			"plans/a.md",
		]);
		expect(Object.keys(bundle.machine)).toEqual([
			"agents.json",
			"offered.json",
		]);
		expect(JSON.stringify(bundle)).not.toContain("secret");

		const done = await importBundle(places(to), bundle, { force: false });
		expect(done.written).toHaveLength(4);
		expect(await get(to, "plans/a.md")).toBe("plan");
	});

	it("stops on a differing file unless forced", async () => {
		await put(from, "hooks.json", "new");
		await put(to, "hooks.json", "old");
		const bundle = await exportBundle(places(from), []);
		await expect(
			importBundle(places(to), bundle, { force: false }),
		).rejects.toThrow("differ");
		expect(await get(to, "hooks.json")).toBe("old");
		await importBundle(places(to), bundle, { force: true });
		expect(await get(to, "hooks.json")).toBe("new");
	});

	it("refuses a bundle that reaches outside or names creds", () => {
		const bundle = (project: Record<string, string>) =>
			JSON.stringify({
				format: "splates-config",
				version: 2,
				project,
				machine: {},
				creds: [],
			});
		expect(() => parseBundle(bundle({ "../x": "" }), "f")).toThrow();
		expect(() => parseBundle(bundle({ "creds.json": "" }), "f")).toThrow();
		expect(() => parseBundle("{}", "f")).toThrow();
	});

	it("carries what to ask for again, never a value, and asks for what is not kept", async () => {
		await from.creds.request("API_TOKEN", {
			scope: "project",
			purpose: "To call the API.",
			instructions: "Make one on its settings page.",
			task: null,
		});
		await from.creds.save("API_TOKEN", "secret");
		await from.creds.request("GONE", {
			scope: "device",
			purpose: "Turned down.",
			instructions: "Nowhere.",
			task: null,
		});
		await from.creds.dismiss("GONE");
		await from.creds.request("KEPT_THERE", {
			scope: "device",
			purpose: "To sign in.",
			instructions: "Copy it from the dashboard.",
			task: null,
		});
		await to.creds.save("KEPT_THERE", "already", { scope: "device" });

		const bundle = await exportBundle(
			places(from),
			await from.creds.requests(),
		);
		expect(bundle.creds.map((each) => each.name)).toEqual([
			"API_TOKEN",
			"KEPT_THERE",
		]);
		expect(JSON.stringify(bundle)).not.toContain("secret");

		const read = parseBundle(JSON.stringify(bundle), "f");
		expect(await askAgain(to.creds, read)).toEqual(["API_TOKEN"]);
		const [asked] = (await to.creds.requests()).filter(
			(each) => each.status === "open",
		);
		expect(asked).toMatchObject({
			name: "API_TOKEN",
			scope: "project",
			purpose: "To call the API.",
			instructions: "Make one on its settings page.",
			task: null,
		});
	});

	it("reads an export from before creds went with it", () => {
		const read = parseBundle(
			JSON.stringify({
				format: "splates-config",
				version: 1,
				project: {},
				machine: {},
			}),
			"f",
		);
		expect(read.creds).toEqual([]);
	});
});
