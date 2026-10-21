import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { decodeTask, encodeTask } from "../board";
import { movedProjects } from "./paths";
import { stage } from "./stage";

const HOME = "/Users/me/.splates";
const ROOT = "/Users/me/Projects/splates";
const WORKTREES = "/Users/me/Projects/splates-splates.noindex";
const STAGING = "/tmp/move";

describe("stage", () => {
	let fs: FakeFs;

	beforeEach(async () => {
		fs = new FakeFs();
		const write = fs.write.bind(fs);
		// As on a disk, each file's directories are there to stat.
		fs.write = async (path, data) => {
			await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
			await write(path, data);
		};
		await fs.write(
			`${HOME}/projects.json`,
			JSON.stringify({
				format: 1,
				projects: [{ root: ROOT }],
				focused: [ROOT],
			}),
		);
		await fs.write(`${HOME}/projects.lock`, "1");
		await fs.write(`${HOME}/slots.json`, "{}");
		await fs.write(`${HOME}/push.json`, '{"vapid":"keys"}');
		const records = `${ROOT}/.git/splates`;
		await fs.write(`${records}/format`, "3");
		await fs.write(`${records}/tasks.lock`, "1");
		await fs.write(`${records}/merge.lock/holder.json`, "{}");
		await fs.write(`${records}/conversations/c1.jsonl`, `{"cwd":"${ROOT}"}\n`);
		await fs.write(
			`${records}/tasks/1.md`,
			encodeTask({ id: 1, task: "fix", branch: "task/fix" }),
		);
		await fs.write(
			`${records}/tasks/2.md`,
			encodeTask({
				id: 2,
				task: "far",
				machine: "hetzner-1",
				worktree: "/home/splates/.splates/worker/projects/splates/far",
			}),
		);

		await stage({
			fs,
			home: HOME,
			staging: STAGING,
			worker: "macbook",
			projects: movedProjects([{ slug: "splates", root: ROOT }]).map(
				(each) => ({ ...each, worktreeRoot: WORKTREES }),
			),
		});
	});

	const read = async (path: string) =>
		JSON.parse(await fs.read(`${STAGING}/${path}`));

	it("carries the coordinator's home files with its roots as the box's", async () => {
		expect(await read("home/projects.json")).toEqual({
			format: 1,
			projects: [{ root: "/home/splates/projects/splates" }],
			focused: ["/home/splates/projects/splates"],
		});
		expect(await read("home/push.json")).toEqual({ vapid: "keys" });
	});

	it("leaves out locks and dev slots", async () => {
		expect(await fs.exists(`${STAGING}/home/projects.lock`)).toBe(false);
		expect(await fs.exists(`${STAGING}/home/slots.json`)).toBe(false);
		expect(await fs.exists(`${STAGING}/projects/splates/tasks.lock`)).toBe(
			false,
		);
		expect(await fs.exists(`${STAGING}/projects/splates/merge.lock`)).toBe(
			false,
		);
	});

	it("turns the box's own worker off, so agents run on workers alone", async () => {
		expect((await read("home/workers.json")).local).toBe(false);
	});

	it("leaves a conversation's paths as the worker that ran it has them", async () => {
		expect(
			await fs.read(`${STAGING}/projects/splates/conversations/c1.jsonl`),
		).toBe(`{"cwd":"${ROOT}"}\n`);
	});

	it("puts each task worked here on this machine's worker, in its worktree", async () => {
		const task = async (id: number) =>
			decodeTask(await fs.read(`${STAGING}/projects/splates/tasks/${id}.md`));
		expect(await task(1)).toEqual({
			id: 1,
			task: "fix",
			branch: "task/fix",
			worktree: `${WORKTREES}/fix`,
			machine: "macbook",
			text: "",
		});
		expect((await task(2))?.machine).toBe("hetzner-1");
	});
});

describe("stage with a tunnel from the stack", () => {
	it("writes the box's tunnel.json from it, over the machine's own", async () => {
		const fs = new FakeFs();
		await fs.mkdir(`${HOME}`, { recursive: true });
		await fs.write(`${HOME}/tunnel.json`, '{"format":1,"host":"old"}');
		await stage({
			fs,
			home: HOME,
			staging: STAGING,
			worker: "macbook",
			projects: [],
			tunnel: { host: "h.example.com", team: "acme", aud: "a", tunnel: "t" },
		});

		expect(JSON.parse(await fs.read(`${STAGING}/home/tunnel.json`))).toEqual({
			format: 1,
			host: "h.example.com",
			team: "acme",
			aud: "a",
			tunnel: "t",
		});
	});
});
