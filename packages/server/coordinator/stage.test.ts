import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
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
		await fs.write(`${records}/todos.lock`, "1");
		await fs.write(`${records}/merge.lock/holder.json`, "{}");
		await fs.write(`${records}/conversations/c1.jsonl`, `{"cwd":"${ROOT}"}\n`);
		await fs.write(
			`${records}/tasks/fix.json`,
			JSON.stringify({ task: "fix", branch: "task/fix" }),
		);
		await fs.write(
			`${records}/tasks/far.json`,
			JSON.stringify({
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
		expect(await fs.exists(`${STAGING}/projects/splates/todos.lock`)).toBe(
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
		expect(await read("projects/splates/tasks/fix.json")).toEqual({
			task: "fix",
			branch: "task/fix",
			worktree: `${WORKTREES}/fix`,
			machine: "macbook",
		});
		expect((await read("projects/splates/tasks/far.json")).machine).toBe(
			"hetzner-1",
		);
	});
});
