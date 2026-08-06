import { expect, test } from "bun:test";
import type { Fs, MkdirOptions, RmOptions, StatResult } from "@webappwiz/sys";
import { FakeFs, FakePs } from "@webappwiz/sys/testing";
import type { Config } from "./config";
import { Git } from "./git";
import { WorktreeStore } from "./worktree-store";

/** Records every filesystem call so the write path can be asserted on. */
class RecordingFs implements Fs {
	readonly ops: string[] = [];

	constructor(private readonly inner: Fs) {}

	exists(path: string): Promise<boolean> {
		return this.inner.exists(path);
	}
	mkdir(path: string, options?: MkdirOptions): Promise<void> {
		return this.inner.mkdir(path, options);
	}
	read(path: string): Promise<string> {
		return this.inner.read(path);
	}
	write(path: string, data: string): Promise<void> {
		this.ops.push(`write ${path}`);
		return this.inner.write(path, data);
	}
	rename(from: string, to: string): Promise<void> {
		this.ops.push(`rename ${from} -> ${to}`);
		return this.inner.rename(from, to);
	}
	readdir(path: string): Promise<string[]> {
		return this.inner.readdir(path);
	}
	stat(path: string): Promise<StatResult> {
		return this.inner.stat(path);
	}
	rm(path: string, options?: RmOptions): Promise<void> {
		return this.inner.rm(path, options);
	}
}

/** Dies halfway through a write, leaving a truncated file behind. */
class CrashingFs extends FakeFs {
	crash = false;

	override async write(path: string, data: string): Promise<void> {
		if (!this.crash) {
			return super.write(path, data);
		}
		await super.write(path, data.slice(0, data.length / 2));
		throw new Error("boom");
	}
}

const config: Config = {
	testCommand: "true",
	trunk: "main",
	worktreeRoot: "/repo-arbor",
	portRange: [3100, 3199],
	postCreate: null,
	leaseStalenessMs: 90_000,
	graftRetryBudget: 2,
	rememberedPrunes: 50,
};

function store(
	fs: Fs,
	overrides: Partial<Config> = {},
	ps = new FakePs(),
): WorktreeStore {
	return new WorktreeStore(
		fs,
		ps,
		new Git(ps, fs, "/repo"),
		{ ...config, ...overrides },
		"/repo/.git/arbor",
	);
}

test("records land by rename, never by writing in place", async () => {
	const fs = new RecordingFs(new FakeFs());
	const worktrees = store(fs);

	await (await worktrees.find("alpha")).save();

	const path = worktrees.recordPath("alpha");
	expect(fs.ops).toEqual([
		`write ${path}.4242.tmp`,
		`rename ${path}.4242.tmp -> ${path}`,
	]);
	expect((await worktrees.find("alpha")).state).toMatchObject({
		task: "alpha",
	});
});

test("a write that dies partway leaves the previous record readable", async () => {
	const fs = new CrashingFs();
	const worktrees = store(fs);
	const saved = await (await worktrees.find("alpha")).save({ port: 3101 });

	fs.crash = true;
	await expect(saved.save({ port: 3199 })).rejects.toThrow("boom");

	// The truncated bytes went to the temp path; the record itself never moved.
	expect((await worktrees.find("alpha")).state).toMatchObject({ port: 3101 });
});

test("a record that will not parse reads as unknown, not as absent", async () => {
	const fs = new FakeFs();
	const ps = new FakePs();
	ps.exit(1); // every spawn now fails, so git reports no such branch
	const worktrees = store(fs, {}, ps);
	await fs.write(worktrees.recordPath("alpha"), "{not json");

	expect((await worktrees.find("alpha")).status).toBe("unknown");
	expect((await worktrees.find("missing")).status).toBe("absent");
});

test("ports are deterministic and inside the configured range", () => {
	const worktrees = store(new FakeFs());

	expect(worktrees.portFor("alpha")).toBe(worktrees.portFor("alpha"));
	for (const task of ["alpha", "beta", "a-longer-task-name", "z"]) {
		expect(worktrees.portFor(task)).toBeGreaterThanOrEqual(3100);
		expect(worktrees.portFor(task)).toBeLessThanOrEqual(3199);
	}
});

test("the memory of pruned names drops its oldest entries", async () => {
	const fs = new FakeFs();
	const worktrees = store(fs, { rememberedPrunes: 2 });
	const pruned = "/repo/.git/arbor/pruned";
	await worktrees.init();

	// Seeded with distinct timestamps, since four discards in the same
	// millisecond would have nothing to order them by.
	for (const [i, task] of ["oldest", "middle", "newest"].entries()) {
		await fs.write(`${pruned}/${task}`, `2026-0${i + 1}-01T00:00:00.000Z\n`);
	}

	await worktrees.discard(await worktrees.find("alpha"));

	expect((await fs.readdir(pruned)).sort()).toEqual(["alpha", "newest"]);
});
