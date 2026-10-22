import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration, SystemWallClock } from "webappwiz/time";
import { Testing } from "../testing";
import { WorkerDaemon } from "./daemon";
import { JobPool } from "./job-pool";
import { JobEvent, RunnerJobs } from "./job-route";
import { JobSnapshot } from "./job-snapshot";
import { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import { FakeJobView } from "./testing";
import { UnixWorkerListener } from "./unix-listener";
import { UnixWorkerSocket } from "./unix-socket";

describe("heavy jobs on a runner", () => {
	let dir: string;
	let registry: WorkerRegistry;
	let listener: UnixWorkerListener;
	let daemon: WorkerDaemon;
	let worker: RemoteWorker;
	let deps: Testing;
	let snapshot: JobSnapshot;

	beforeEach(async () => {
		deps = await Testing.open();
		snapshot = new JobSnapshot(deps.git);
		dir = await mkdtemp(join(tmpdir(), "splates-runner-"));
		const path = join(dir, "worker.sock");
		registry = new WorkerRegistry(new MemoryLogger());
		listener = await UnixWorkerListener.listen(path, new NodeFs());
		listener.events.on("socket", (socket) => void registry.accept(socket));
		const joined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		daemon = new WorkerDaemon(
			{ where: path, dial: () => UnixWorkerSocket.connect(path) },
			{
				id: "runner",
				slots: 2,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
				runnerHome: join(dir, "runner"),
			},
		);
		void daemon.run();
		worker = await joined;
	});

	afterEach(async () => {
		await daemon.disposeAsync();
		registry.dispose();
		await listener.disposeAsync();
		await rm(dir, { recursive: true, force: true });
		await deps[Symbol.asyncDispose]();
	});

	/** Runs `argv` on the runner against `deps.root` as it stands. */
	async function job(
		argv: string[],
		extra: {
			prepare?: string;
			files?: string[];
			env?: Record<string, string>;
			signal?: AbortSignal;
			timeoutMs?: number;
		} = {},
	) {
		const commit = await snapshot.take(deps.root);
		const out: Uint8Array[] = [];
		const tips: (string | null)[] = [];
		const result = await worker.job(
			{
				project: deps.root,
				commit,
				task: null,
				prepare: extra.prepare ?? null,
				argv,
				env: extra.env ?? {},
				files: extra.files ?? [],
				timeoutMs: extra.timeoutMs ?? null,
			},
			{
				bundle: (tip) => {
					tips.push(tip);
					return snapshot.bundle(deps.root, commit, tip);
				},
				output: (bytes) => out.push(bytes),
				...(extra.signal === undefined ? {} : { signal: extra.signal }),
			},
		);
		return { result, tips, commit, text: Buffer.concat(out).toString() };
	}

	it("runs the command in a checkout of the worktree as it stands, uncommitted edits included", async () => {
		await writeFile(join(deps.root, "README.md"), "edited\n");
		await writeFile(join(deps.root, "new.txt"), "untracked\n");
		const headBefore = await deps.gitCli(deps.root, "rev-parse", "HEAD");
		const indexBefore = await deps.gitCli(deps.root, "status", "--porcelain");

		const { result, text } = await job([
			"sh",
			"-c",
			"cat README.md new.txt; echo err >&2; exit 3",
		]);

		expect(text).toContain("edited");
		expect(text).toContain("untracked");
		expect(text).toContain("err");
		expect(result.code).toBe(3);
		expect(await deps.gitCli(deps.root, "rev-parse", "HEAD")).toBe(headBefore);
		expect(await deps.gitCli(deps.root, "status", "--porcelain")).toBe(
			indexBefore,
		);
	});

	it("ships only what the runner lacks the second time", async () => {
		const first = await job(["true"]);
		await writeFile(join(deps.root, "more.txt"), "more\n");

		const second = await job(["cat", "more.txt"]);

		expect(first.tips).toEqual([null]);
		expect(second.tips).toEqual([first.commit]);
		expect(second.text).toBe("more\n");
	});

	it("runs the prepare step first, and returns the files the job wrote", async () => {
		const { result, text } = await job(
			["sh", "-c", 'cat prepared > "$SPLATES_JOB_FILES/report.xml"'],
			{ prepare: "echo ready > prepared", files: ["report.xml", "absent"] },
		);

		expect(text).toBe("");
		expect(result.code).toBe(0);
		expect(new TextDecoder().decode(result.files.get("report.xml"))).toBe(
			"ready\n",
		);
		expect(result.files.has("absent")).toBe(false);
	});

	it("skips the command and answers the exit code of a failed prepare step", async () => {
		const { result, text } = await job(["echo", "ran"], {
			prepare: "echo no; exit 4",
		});

		expect(result.code).toBe(4);
		expect(text).toBe("no\n");
	});

	it("passes the job's environment and nothing of the coordinator's creds", async () => {
		const { text } = await job(["sh", "-c", "echo $HELLO $SPLATES_WORKTREE"], {
			env: { HELLO: "hi" },
		});

		expect(text).toStartWith("hi ");
		expect(text).toContain("tree");
	});

	it("kills the command when the caller aborts", async () => {
		const abort = new AbortController();
		const running = job(["sleep", "30"], { signal: abort.signal });
		await Bun.sleep(300);

		abort.abort();

		await expect(running).rejects.toThrow("cancelled");
	});

	it("kills a command that runs past its timeout, and exits 124 saying so", async () => {
		const { result, text } = await job(["sh", "-c", "echo started; sleep 30"], {
			timeoutMs: 300,
		});

		expect(result.code).toBe(124);
		expect(text).toContain("started");
		expect(text).toContain("killed after running past its 300ms timeout");
	});

	it("counts a slow prepare step against the timeout, and skips the command", async () => {
		const { result, text } = await job(["echo", "ran"], {
			prepare: "sleep 30",
			timeoutMs: 300,
		});

		expect(result.code).toBe(124);
		expect(text).not.toContain("ran");
	});

	// Asks little of the runner, this machine, whatever it has.
	const post = (jobs: RunnerJobs, size = { cpus: 1, memory: 0.5 }) =>
		jobs.run(
			new Request("http://localhost/api/jobs", {
				method: "POST",
				body: JSON.stringify({
					worktree: deps.root,
					project: deps.root,
					argv: ["sh", "-c", "echo hi; exit 2"],
					...size,
				}),
			}),
		);

	const jobsOf = (of: WorkerRegistry) =>
		new RunnerJobs(
			of,
			new JobPool(new FakeJobView(of), new SystemWallClock()),
			new NodePs(),
			new MemoryLogger(),
		);

	const events = async (response: Response) =>
		(await response.text())
			.trim()
			.split("\n")
			.map((line) => JobEvent.parse(JSON.parse(line)));

	it("sends a job request to its caller to run itself where no runner is up or can be made", async () => {
		const response = await post(jobsOf(new WorkerRegistry(new MemoryLogger())));

		expect(await events(response)).toEqual([{ type: "local" }]);
	});

	it("says in the runner's hello the CPUs it has and its memory to the GB", () => {
		expect(worker.info).toMatchObject({
			jobs: true,
			cpus: availableParallelism(),
			memory: Math.round(totalmem() / 1024 ** 3),
		});
	});

	it("sends a job request to its caller to run itself when it asks more than any runner has", async () => {
		const response = await post(jobsOf(registry), {
			cpus: availableParallelism() + 1,
			memory: 0.5,
		});

		expect(await events(response)).toEqual([
			{
				type: "local",
				tooBig: {
					asked: { cpus: availableParallelism() + 1, memory: 0.5 },
					largest: {
						cpus: availableParallelism(),
						memory: Math.round(totalmem() / 1024 ** 3),
					},
				},
			},
		]);
	});

	it("streams a job request's output and exit code from the runner", async () => {
		const response = await post(jobsOf(registry));

		expect(await events(response)).toEqual([
			{ type: "out", data: Buffer.from("hi\n").toString("base64") },
			{ type: "exit", code: 2 },
		]);
	});
});
