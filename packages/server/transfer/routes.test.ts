import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { json, post, serving } from "../server/testing";
import { Testing } from "../testing";

describe("config transfer routes", () => {
	let deps: Testing;
	beforeEach(async () => {
		deps = await Testing.open();
	});
	afterEach(() => deps.disposeAsync());

	const bundle = (project: Record<string, string>) =>
		JSON.stringify({
			format: "splates-config",
			version: 2,
			project,
			machine: {},
			creds: [],
		});

	/** Uploads `text` in parts of `size` characters, as the page does. */
	const put = (path: string, text: string) => {
		const at = path.lastIndexOf("/");
		return deps.storage
			.collection(at < 0 ? "" : path.slice(0, at))
			.write(path.slice(at + 1), text);
	};

	const get = (path: string) => {
		const at = path.lastIndexOf("/");
		return deps.storage
			.collection(at < 0 ? "" : path.slice(0, at))
			.read(path.slice(at + 1));
	};

	const upload = async (
		port: number,
		id: string,
		text: string,
		size: number,
	) => {
		for (let part = 0; part * size < text.length; part++) {
			const sent = await post(
				port,
				`/api/config/import/parts?upload=${id}&part=${part}`,
				text.slice(part * size, (part + 1) * size),
			);
			expect(sent.status).toBe(204);
		}
	};

	it("downloads an export, leaving conversations out when asked", async () => {
		await put("hooks.json", "{}");
		await deps.storage.log("conversations/a.jsonl").append({ a: 1 });
		await serving(deps, async (_snapshot, port) => {
			const all = await fetch(`http://127.0.0.1:${port}/api/config/export`);
			expect(all.headers.get("content-disposition")).toContain("attachment");
			expect(Object.keys((await all.json()).project).sort()).toEqual([
				"conversations/a.jsonl",
				"hooks.json",
			]);
			const lean = await fetch(
				`http://127.0.0.1:${port}/api/config/export?conversations=0`,
			);
			expect(Object.keys((await lean.json()).project)).toEqual(["hooks.json"]);
		});
	});

	it("imports an upload sent in parts, asking before it overwrites and keeping the conversations here", async () => {
		await put("hooks.json", "old");
		await deps.storage.log("conversations/a.jsonl").append({ v: "here" });
		const text = bundle({
			"hooks.json": "new",
			"plans/p.md": "plan",
			"conversations/a.jsonl": '{"v":"there"}\n',
		});
		await serving(deps, async (_snapshot, port) => {
			await upload(port, "upload-one", text, 7);
			const stopped = await json(port, "/api/config/import", "POST", {
				upload: "upload-one",
			});
			expect(stopped.status).toBe(409);
			expect((await stopped.json()).conflicts).toEqual(["project hooks.json"]);
			expect(await get("hooks.json")).toBe("old");

			const forced = await json(port, "/api/config/import", "POST", {
				upload: "upload-one",
				force: true,
			});
			expect(await forced.json()).toEqual({
				written: ["project hooks.json", "project plans/p.md"],
				kept: ["project conversations/a.jsonl"],
				asked: [],
			});
			expect(await get("hooks.json")).toBe("new");
			expect(await get("conversations/a.jsonl")).toBe('{"v":"here"}\n');
			expect(await deps.fs.exists(`${deps.dir}/imports/upload-one.json`)).toBe(
				false,
			);
		});
	});

	it("refuses an upload id it did not make and a part with nothing before it", async () => {
		await serving(deps, async (_snapshot, port) => {
			const bad = await post(
				port,
				"/api/config/import/parts?upload=../x&part=0",
				"",
			);
			expect(bad.status).toBe(400);
			const orphan = await post(
				port,
				"/api/config/import/parts?upload=upload-two&part=1",
				"",
			);
			expect(orphan.status).toBe(404);
		});
	});
});
