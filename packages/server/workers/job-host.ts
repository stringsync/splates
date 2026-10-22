import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AsyncResource, Resource } from "webappwiz/disposable";
import type { Child, Ps } from "webappwiz/system";
import type { WorkerChannel } from "./channel";
import { JobParams, JobTold } from "./job";
import { descendants } from "./process-host";
import type { WorkerSession } from "./session";

/** The ref a runner's warm clone keeps the last snapshot it fetched at. */
export const TIP_REF = "refs/splates/tip";

/** Where a runner keeps one project's warm clone, apart from every other's. */
export function cloneDir(home: string, project: string): string {
	const key = new Bun.CryptoHasher("sha256")
		.update(project)
		.digest("hex")
		.slice(0, 16);
	return join(home, key);
}

/**
 * One heavy job on a runner, stateless beyond a warm bare clone per project:
 * it says what it holds of the project, takes the bundle the server ships,
 * checks the snapshot out in a throwaway worktree, runs the prepare step and
 * then the command there, and streams the output back as data. Once the
 * command exits it sends the exit code and the files it asked for, and
 * forgets the worktree. Closing the channel kills the command and
 * everything it started. No creds reach it: its environment is the runner's
 * own plus what the job names.
 */
export class WorkerJobHost implements Resource, AsyncResource {
	private readonly params: JobParams;
	private readonly repo: string;
	private readonly dir: string;
	private readonly tree: string;
	private readonly filesDir: string;
	private bundle: Promise<void> = Promise.resolve();
	private child: Child | null = null;
	private cancelled = false;
	private disposed = false;
	/** Settles once the checkout and the job's files are gone. */
	private forgotten: Promise<void> = Promise.resolve();

	constructor(
		private readonly channel: WorkerChannel,
		private readonly session: WorkerSession,
		private readonly ps: Ps,
		home: string,
	) {
		this.params = JobParams.parse(channel.params);
		const base = cloneDir(home, this.params.project);
		this.repo = join(base, "repo.git");
		this.dir = join(
			base,
			"jobs",
			`${String(channel.id)}-${crypto.randomUUID()}`,
		);
		this.tree = join(this.dir, "tree");
		this.filesDir = join(this.dir, "files");
		channel.events.on("data", ({ bytes }) => {
			this.bundle = this.bundle.then(() =>
				appendFile(join(this.dir, "in.bundle"), bytes),
			);
		});
		channel.events.on("message", ({ body }) => this.told(body));
		channel.events.on("close", () => this.dispose());
		void this.begin();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.cancelled = true;
		this.forgotten = this.kill().then(() => this.forget());
	}

	/** Disposes and waits until the job's files are gone. */
	async disposeAsync(): Promise<void> {
		this.dispose();
		await this.forgotten;
	}

	private told(body: unknown): void {
		const parsed = JobTold.safeParse(body);
		if (!parsed.success) {
			return;
		}
		if (parsed.data.type === "cancel") {
			this.cancelled = true;
			void this.kill();
			return;
		}
		void this.run(parsed.data.bytes);
	}

	private async begin(): Promise<void> {
		try {
			await mkdir(this.filesDir, { recursive: true });
			if (!(await Bun.file(join(this.repo, "HEAD")).exists())) {
				await this.git(["init", "--bare", "--quiet", this.repo]);
			}
			const tip = await this.tip();
			this.channel.send({ type: "have", tip });
		} catch (error) {
			this.fail(error);
		}
	}

	/** The last snapshot the warm clone holds, if it still has it. */
	private async tip(): Promise<string | null> {
		const { exitCode, stdout } = await this.ps.spawnCapture([
			"git",
			"-C",
			this.repo,
			"rev-parse",
			"--verify",
			"--quiet",
			TIP_REF,
		]);
		return exitCode === 0 ? stdout.trim() : null;
	}

	private async run(shipped: number): Promise<void> {
		try {
			await this.bundle;
			if (this.cancelled) {
				return;
			}
			const { commit } = this.params;
			if (shipped > 0) {
				const file = join(this.dir, "in.bundle");
				const size = (await stat(file)).size;
				if (size !== shipped) {
					throw new Error(`the bundle came to ${size} bytes of ${shipped}`);
				}
				const heads = await this.git(["bundle", "list-heads", file], this.repo);
				const head = heads
					.split("\n")
					.map((line) => line.split(" "))
					.find(([sha]) => sha === commit)?.[1];
				if (head === undefined) {
					throw new Error(`the bundle does not hold ${commit}`);
				}
				await this.git(
					["fetch", "--quiet", file, `+${head}:${TIP_REF}`],
					this.repo,
				);
				await rm(file, { force: true });
			}
			await this.git(["cat-file", "-e", `${commit}^{commit}`], this.repo);
			await this.git(["update-ref", TIP_REF, commit], this.repo);
			this.channel.send({ type: "preparing" });
			await this.git(
				["worktree", "add", "--quiet", "--detach", this.tree, commit],
				this.repo,
			);
			const env = {
				...this.params.env,
				SPLATES_WORKTREE: this.tree,
				SPLATES_JOB_FILES: this.filesDir,
			};
			let code = 0;
			if (this.params.prepare !== null) {
				code = await this.exec(["sh", "-c", this.params.prepare], env);
			}
			if (code === 0 && !this.cancelled) {
				this.channel.send({ type: "started" });
				code = await this.exec(this.params.argv, env);
			}
			if (this.cancelled) {
				return;
			}
			this.channel.send({ type: "exit", code });
			await this.sendFiles();
			this.channel.send({ type: "done" });
		} catch (error) {
			this.fail(error);
		}
	}

	/** Runs `argv` in the checkout with its output on the channel, answering its exit code. */
	private async exec(
		argv: string[],
		env: Record<string, string>,
	): Promise<number> {
		const child = this.ps.start(argv, { cwd: this.tree, env });
		this.child = child;
		const pump = async (stream: ReadableStream<Uint8Array>) => {
			try {
				for await (const bytes of stream) {
					if (this.channel.closed) {
						return;
					}
					if (!this.channel.write(bytes)) {
						await this.session.drained();
					}
				}
			} catch {
				// A process that never started has no output; its exit says why.
			}
		};
		void child.stdin.close().catch(() => {});
		await Promise.all([pump(child.stdout), pump(child.stderr)]);
		const code = await child.exited.catch((error: unknown) => {
			if (!this.channel.closed) {
				this.channel.write(
					new TextEncoder().encode(
						`cannot start ${argv[0]}: ${error instanceof Error ? error.message : String(error)}\n`,
					),
				);
			}
			return 127;
		});
		this.child = null;
		return code;
	}

	private async sendFiles(): Promise<void> {
		for (const name of this.params.files) {
			const bytes = await readFile(join(this.filesDir, name)).catch(() => null);
			if (bytes === null || this.channel.closed) {
				continue;
			}
			this.channel.send({ type: "file", name, size: bytes.byteLength });
			if (!this.channel.write(new Uint8Array(bytes))) {
				await this.session.drained();
			}
		}
	}

	private async kill(): Promise<void> {
		const pid = this.child?.pid ?? null;
		const under =
			pid === null
				? []
				: descendants(await this.ps.processes().catch(() => []), pid);
		this.child?.kill();
		if (under.length > 0) {
			await this.ps
				.spawn(["kill", "-TERM", ...under.map(String)])
				.catch(() => {});
		}
	}

	/** Takes the checkout and the job's files away; the warm clone stays. */
	private async forget(): Promise<void> {
		await this.ps
			.spawnCapture([
				"git",
				"-C",
				this.repo,
				"worktree",
				"remove",
				"--force",
				this.tree,
			])
			.catch(() => {});
		// A child still dying under the checkout can fail the removal; a
		// stray directory left behind is no reason to fail closing the job.
		await rm(this.dir, { recursive: true, force: true }).catch(() => {});
		await this.ps
			.spawnCapture(["git", "-C", this.repo, "worktree", "prune"])
			.catch(() => {});
	}

	private fail(error: unknown): void {
		if (!this.channel.closed) {
			this.channel.send({
				type: "failed",
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async git(args: string[], at?: string): Promise<string> {
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture([
			"git",
			...(at === undefined ? [] : ["-C", at]),
			...args,
		]);
		if (exitCode !== 0) {
			throw new Error(
				`git ${args[0]} failed: ${stderr.trim() || stdout.trim()}`,
			);
		}
		return stdout;
	}
}
