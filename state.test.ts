import { expect, test } from "bun:test";
import { MemoryLogger } from "@webappwiz/log";
import type { Fs, MkdirOptions, RmOptions, StatResult } from "@webappwiz/sys";
import { FakeFs, FakePs } from "@webappwiz/sys/testing";
import { type Config, type Ctx, portFor } from "./context";
import {
	leaseIsLive,
	leaseIsOurs,
	readState,
	statePath,
	type TaskState,
	writeState,
} from "./state";

const config: Config = {
	testCommand: "true",
	trunk: "main",
	worktreeRoot: "/repo-arbor",
	portRange: [3100, 3199],
	postCreate: null,
	leaseStalenessMs: 90_000,
	graftRetryBudget: 2,
};

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

function context(fs: Fs, ps = new FakePs()): Ctx {
	return {
		fs,
		ps,
		log: new MemoryLogger(),
		root: "/repo",
		gitDir: "/repo/.git",
		arborDir: "/repo/.git/arbor",
		tasksDir: "/repo/.git/arbor/tasks",
		prunedDir: "/repo/.git/arbor/pruned",
		lockPath: "/repo/.git/arbor/graft.lock",
		config,
	};
}

function state(task = "alpha", over: Partial<TaskState> = {}): TaskState {
	const now = new Date().toISOString();
	return {
		task,
		branch: `task/${task}`,
		worktree: `/repo-arbor/${task}`,
		status: "working",
		lease: null,
		port: 3100,
		graftAttempts: 0,
		createdAt: now,
		updatedAt: now,
		...over,
	};
}

test("state files land by rename, never by writing in place", async () => {
	const fs = new RecordingFs(new FakeFs());
	const ctx = context(fs);

	await writeState(ctx, state());

	const path = statePath(ctx, "alpha");
	expect(fs.ops).toEqual([
		`write ${path}.4242.tmp`,
		`rename ${path}.4242.tmp -> ${path}`,
	]);
	expect(await readState(ctx, "alpha")).toMatchObject({ task: "alpha" });
});

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

test("a write that dies partway leaves the previous state readable", async () => {
	const fs = new CrashingFs();
	const ctx = context(fs);
	await writeState(ctx, state("alpha", { port: 3101 }));

	fs.crash = true;
	await expect(writeState(ctx, state("alpha", { port: 3199 }))).rejects.toThrow(
		"boom",
	);

	// The truncated bytes went to the temp path; the record itself never moved.
	expect(await readState(ctx, "alpha")).toMatchObject({ port: 3101 });
});

test("a corrupt state file throws rather than returning half a task", async () => {
	const fs = new FakeFs();
	const ctx = context(fs);
	await fs.write(statePath(ctx, "alpha"), "{not json");

	expect(readState(ctx, "alpha")).rejects.toThrow();
	expect(await readState(ctx, "missing")).toBeNull();
});

test("a lease is live only while its owner still exists", async () => {
	const ps = new FakePs();
	const ctx = context(new FakeFs(), ps);
	const now = new Date().toISOString();

	const mine = { pid: ps.pid, hostname: ps.hostname, heartbeatAt: now };
	expect(leaseIsLive(ctx, mine)).toBe(true);
	expect(leaseIsOurs(ctx, mine)).toBe(true);

	expect(leaseIsLive(ctx, null)).toBe(false);
	expect(
		leaseIsLive(ctx, {
			...mine,
			heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
		}),
	).toBe(false);

	const others = { pid: 777, hostname: ps.hostname, heartbeatAt: now };
	expect(leaseIsLive(ctx, others)).toBe(true);
	expect(leaseIsOurs(ctx, others)).toBe(false);
	ps.kill(777);
	expect(leaseIsLive(ctx, others)).toBe(false);

	// Another host's pid says nothing about ours, so the heartbeat rules.
	expect(
		leaseIsLive(ctx, { pid: 777, hostname: "elsewhere", heartbeatAt: now }),
	).toBe(true);
});

test("ports are deterministic and inside the range", () => {
	expect(portFor("alpha", [3100, 3199])).toBe(portFor("alpha", [3100, 3199]));
	for (const task of ["alpha", "beta", "a-longer-task-name", "z"]) {
		const port = portFor(task, [3100, 3199]);
		expect(port).toBeGreaterThanOrEqual(3100);
		expect(port).toBeLessThanOrEqual(3199);
	}
});
