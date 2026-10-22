import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { FileLock, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { Git } from "../git";
import type { RunnerRow } from "../spend";
import { WorkerBudget } from "./budget";
import { DIRECT_TAG, DirectRunners } from "./direct";
import type { DirectRunnerReport } from "./direct-runner-report";
import { cloudSize, FakeCloud } from "./fake-cloud";
import { JobSnapshot } from "./job-snapshot";
import { LocalShell } from "./local-shell";
import { NoRunner } from "./no-runner";

const ps = new NodePs();

/** Waits for `check` to hold, looking every 10 ms. */
async function until(check: () => boolean): Promise<void> {
	while (!check()) {
		await Bun.sleep(10);
	}
}

describe("the runners `splates run` makes for itself", () => {
	let dir: string;
	let repo: string;
	let cloud: FakeCloud;
	let shell: LocalShell;
	let budget: WorkerBudget;
	let ledger: RunnerRow[];
	let log: MemoryLogger;
	let runners: DirectRunners;
	let booted: number;
	let told: { phase: string; line: string | null }[];
	let listed: DirectRunnerReport[][];

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-direct-"));
		repo = join(dir, "repo");
		await mkdir(repo);
		const git = (...args: string[]) =>
			ps.spawnCapture(["git", "-C", repo, ...args]);
		await git("init", "--quiet", "-b", "main");
		await writeFile(join(repo, "file.txt"), "committed\n");
		await git("add", ".");
		await git(
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"commit",
			"--quiet",
			"-m",
			"one",
		);
		cloud = new FakeCloud([
			cloudSize("small", 2, 4, 0.03),
			cloudSize("medium", 4, 8, 0.07),
			cloudSize("large", 8, 16, 0.14),
		]);
		shell = new LocalShell(join(dir, "runners"), ps);
		budget = WorkerBudget.memory();
		ledger = [];
		log = new MemoryLogger();
		booted = 0;
		told = [];
		listed = [];
		const waited = new Set<string>();
		runners = new DirectRunners({
			status: {
				job: (report, line) => void told.push({ phase: report.phase, line }),
				runners: (each) => void listed.push(each),
			},
			cloud,
			budget: async () => budget,
			ledger: { note: async (...rows) => void ledger.push(...rows) },
			shell,
			publicKey: "ssh-ed25519 AAAA test",
			recipe: "echo recipe",
			lock: new FileLock(join(dir, "place.lock")),
			claims: join(dir, "claims.json"),
			ps,
			log,
			// A machine boots on the second wait after it is made.
			wait: async () => {
				for (const machine of cloud.machinesById.values()) {
					if (machine.status === "starting" && !waited.has(machine.id)) {
						waited.add(machine.id);
					} else if (machine.status === "starting") {
						booted += 1;
						machine.status = "running";
						machine.ipv4 = `10.0.0.${machine.id}`;
						const home = shell.home({ id: "", address: machine.ipv4 });
						await mkdir(join(home, "direct", "jobs"), { recursive: true });
						await writeFile(join(home, ".splates-ready"), "");
					}
				}
				await Bun.sleep(5);
			},
		});
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const snapshot = () => new JobSnapshot(new Git("/", { ps })).take(repo);

	async function run(
		argv: string[],
		opts: Partial<Parameters<DirectRunners["run"]>[0]> = {},
	) {
		const out: Uint8Array[] = [];
		const ran = await runners.run({
			project: join(repo, ".git"),
			cwd: repo,
			commit: await snapshot(),
			size: { cpus: 4, memory: 8 },
			argv,
			env: {},
			prepare: null,
			timeout: null,
			files: [],
			task: null,
			output: (bytes) => void out.push(bytes),
			...opts,
		});
		return { ...ran, out: Buffer.concat(out).toString() };
	}

	it("makes the cheapest runner that holds the job, counted in the budget, and runs the worktree as it stands there", async () => {
		await writeFile(join(repo, "file.txt"), "edited\n");

		const ran = await run([
			"sh",
			"-c",
			'cat file.txt; echo "$SPLATES_CORES $SPLATES_HEAVY"; exit 3',
		]);

		expect(ran.code).toBe(3);
		expect(ran.out).toBe("edited\n4 runner\n");
		expect(cloud.made.map((each) => each.type)).toEqual(["medium"]);
		expect(cloud.made[0]?.tags).toEqual({
			[DIRECT_TAG]: cloud.made[0]?.name as string,
		});
		expect(cloud.made[0]?.userData).toContain("ssh-ed25519 AAAA test");
		expect(cloud.made[0]?.userData).toContain("echo recipe");
		expect(budget.rate()).toBeCloseTo(0.07);
		expect(ledger.map((row) => row.row)).toEqual(["runner", "job"]);
	});

	it("runs the next job on the runner already up, leaving no checkout behind", async () => {
		await run(["true"]);
		const ran = await run(["echo", "again"]);

		expect(ran.out).toBe("again\n");
		expect(cloud.made).toHaveLength(1);
		const home = join(dir, "runners", "10.0.0.1", "direct");
		expect(await readdir(join(home, "jobs"))).toEqual([]);
		const [project] = (await readdir(home)).filter(
			(each) => each !== "jobs" && each !== "last-used",
		);
		expect(await readdir(join(home, project as string, "jobs"))).toEqual([]);
	});

	it("makes another runner when the one up has no room for a job beside the one it runs", async () => {
		const gate = join(dir, "gate");
		const first = run([
			"sh",
			"-c",
			`while [ ! -f ${gate} ]; do sleep 0.05; done; echo first`,
		]);
		await until(() => booted > 0);
		await Bun.sleep(200);

		const second = await run(["echo", "second"]);
		await writeFile(gate, "");

		expect(second.out).toBe("second\n");
		expect((await first).out).toBe("first\n");
		expect(cloud.made).toHaveLength(2);
	});

	it("makes a bigger runner for a job no size up holds", async () => {
		await run(["true"]);
		await run(["true"], { size: { cpus: 8, memory: 16 } });

		expect(cloud.made.map((each) => each.type)).toEqual(["medium", "large"]);
	});

	it("refuses, making nothing, when the budget allows no runner and none is up", async () => {
		await budget.set("hour", 0.05);

		await expect(run(["true"])).rejects.toBeInstanceOf(NoRunner);
		expect(cloud.made).toHaveLength(0);
	});

	it("refuses a job bigger than any size sold", async () => {
		await expect(
			run(["true"], { size: { cpus: 32, memory: 64 } }),
		).rejects.toThrow("no size with 32 CPUs");
	});

	it("kills a job past its timeout, exiting 124 and saying why", async () => {
		const ran = await run(["sleep", "30"], { timeout: Duration.secs(1) });

		expect(ran.code).toBe(124);
		expect(ran.out).toContain("killed after running past its 1s timeout");
	});

	it("runs the prepare step first, and stops at its failure", async () => {
		const ran = await run(["echo", "never"], { prepare: "echo prep; exit 5" });

		expect(ran.code).toBe(5);
		expect(ran.out).toBe("prep\n");
	});

	it("brings back the files the job wrote", async () => {
		const ran = await run(
			["sh", "-c", 'printf report > "$SPLATES_JOB_FILES/report.xml"'],
			{ files: ["report.xml", "missing.xml"] },
		);

		expect(ran.code).toBe(0);
		expect([...ran.files.keys()]).toEqual(["report.xml"]);
		expect(new TextDecoder().decode(ran.files.get("report.xml"))).toBe(
			"report",
		);
	});

	it("kills the job when its caller hangs up", async () => {
		const abort = new AbortController();
		const mark = join(dir, "still-running");
		const ran = run(["sh", "-c", `sleep 1; touch ${mark}`], {
			signal: abort.signal,
		});
		await until(() => booted > 0);
		await Bun.sleep(300);
		abort.abort();
		await ran;
		await Bun.sleep(1200);

		expect(await Bun.file(mark).exists()).toBe(false);
	});

	it("reaps runners idle past the window, ending their cost, and keeps busy ones", async () => {
		await run(["true"]);
		expect(await runners.reap(Duration.hrs(1))).toEqual([]);

		const reaped = await runners.reap(Duration.secs(0));

		expect(reaped).toEqual([expect.stringMatching(/^splates-run-\w+: idle/)]);
		expect(cloud.machinesById.size).toBe(0);
		expect(budget.rate()).toBe(0);
		expect(ledger.map((row) => row.row)).toContain("runner-ended");
	});

	it("lists each runner with its size, price and state", async () => {
		await run(["true"]);

		expect(await runners.list()).toEqual([
			expect.objectContaining({
				type: "medium",
				size: { cpus: 4, memory: 8 },
				dollarsPerHour: 0.07,
				address: "10.0.0.1",
				state: expect.stringMatching(/^idle \d+s$/),
			}),
		]);
	});

	it("tells each step of a job once, with a line for the person, and lists the runners", async () => {
		const ran = await run(["echo", "out"], { prepare: "echo prep" });

		expect(ran.out).toBe("prep\nout\n");
		expect(told.filter((each) => each.line !== null)).toEqual([
			{ phase: "placing", line: "finding a runner with 4 CPUs, 8 GB" },
			{
				phase: "making",
				line: expect.stringMatching(
					/^making splates-run-\w+ in FakeCloud: 4 CPUs, 8 GB, \$0\.07\/h/,
				),
			},
			{
				phase: "booting",
				line: expect.stringMatching(/^waiting for splates-run-\w+ to boot$/),
			},
			{
				phase: "sending",
				line: expect.stringMatching(
					/^on splates-run-\w+ \(10\.0\.0\.1\): sending the worktree$/,
				),
			},
			{ phase: "preparing", line: "preparing: echo prep" },
			{ phase: "running", line: "running echo out" },
			{ phase: "done", line: expect.stringMatching(/^done in /) },
		]);
		expect(listed.at(-1)).toEqual([
			expect.objectContaining({ type: "medium", state: "up" }),
		]);
	});

	it("tells a job that exits otherwise and one that fails in red's words", async () => {
		await run(["sh", "-c", "exit 2"]);
		await budget.set("hour", 0);
		await rm(join(dir, "runners"), { recursive: true });
		cloud.machinesById.clear();

		await expect(run(["true"])).rejects.toBeInstanceOf(NoRunner);

		expect(
			told.filter((each) => each.phase === "done" || each.phase === "failed"),
		).toEqual([
			{ phase: "done", line: expect.stringMatching(/^exited 2 after /) },
			{
				phase: "failed",
				line: expect.stringMatching(/^failed: no runner made/),
			},
		]);
	});
});
