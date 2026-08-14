// judge-ignore-file one-dir-per-interface: RecordingFs and CrashingFs exist to break
// this file's write path, so they belong here rather than shipped from @webappwiz/sys
// judge-ignore-file one-class-per-file: the same two fakes are local to this suite
import { beforeEach, describe, expect, it } from "bun:test";
import type { Fs, MkdirOptions, RmOptions, StatResult } from "@webappwiz/sys";
import { FakeFs, FakePs } from "@webappwiz/sys/testing";
import type { Config } from "./config";
import { Git } from "./git";
import { WorktreeService } from "./worktree-service";

/** Records every filesystem call so the write path can be asserted on. */
class RecordingFs implements Fs {
	readonly ops: string[] = [];

	constructor(private readonly inner: Fs) {}

	exists(path: string): Promise<boolean> {
		return this.inner.exists(path);
	}
	mkdir(path: string, opts?: MkdirOptions): Promise<void> {
		return this.inner.mkdir(path, opts);
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
	rm(path: string, opts?: RmOptions): Promise<void> {
		return this.inner.rm(path, opts);
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

describe("WorktreeService", () => {
	const ARBOR_DIR = "/repo/.git/arbor";
	let ps: FakePs;
	let config: Config;

	beforeEach(() => {
		ps = new FakePs();
		config = {
			trunk: "main",
			worktreeRoot: "/repo-arbor",
			postCheckout: null,
			postRewrite: null,
			preMerge: "true",
			leaseStalenessMs: 90_000,
			mergeRetryCount: 2,
			removedCapacity: 50,
			logCapacity: 200,
		};
	});

	const git = (fs: Fs) => new Git("/repo", { ps: ps, fs: fs });

	it("lands a record by rename, never by writing in place", async () => {
		const fs = new RecordingFs(new FakeFs());
		const worktrees = new WorktreeService(git(fs), config, ARBOR_DIR, {
			fs: fs,
			ps: ps,
		});

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

	it("leaves the previous record readable when a write dies partway", async () => {
		const fs = new CrashingFs();
		const worktrees = new WorktreeService(git(fs), config, ARBOR_DIR, {
			fs: fs,
			ps: ps,
		});
		const saved = await (await worktrees.find("alpha")).save({
			mergeAttempts: 1,
		});

		fs.crash = true;
		await expect(saved.save({ mergeAttempts: 2 })).rejects.toThrow("boom");

		// The truncated bytes went to the temp path; the record itself never moved.
		expect((await worktrees.find("alpha")).state).toMatchObject({
			mergeAttempts: 1,
		});
	});

	it("reports unknown, not absent, when a record will not parse", async () => {
		const fs = new FakeFs();
		ps.exit(1); // every spawn now fails, so git reports no such branch
		const worktrees = new WorktreeService(git(fs), config, ARBOR_DIR, {
			fs: fs,
			ps: ps,
		});
		await fs.write(worktrees.recordPath("alpha"), "{not json");

		expect((await worktrees.find("alpha")).status).toBe("unknown");
		expect((await worktrees.find("missing")).status).toBe("absent");
	});

	it("drops the oldest removed names when the memory is full", async () => {
		const fs = new FakeFs();
		config.removedCapacity = 2;
		const worktrees = new WorktreeService(git(fs), config, ARBOR_DIR, {
			fs: fs,
			ps: ps,
		});
		const removed = `${ARBOR_DIR}/removed`;
		await worktrees.init();

		// Seeded with distinct timestamps, since four discards in the same
		// millisecond would have nothing to order them by.
		for (const [i, task] of ["oldest", "middle", "newest"].entries()) {
			await fs.write(`${removed}/${task}`, `2026-0${i + 1}-01T00:00:00.000Z\n`);
		}

		await worktrees.discard(await worktrees.find("alpha"));

		expect((await fs.readdir(removed)).sort()).toEqual(["alpha", "newest"]);
	});
});
