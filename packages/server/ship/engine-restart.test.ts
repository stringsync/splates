// The engine killed for real: a server process running a ship is sent
// SIGKILL mid-step, while a prompt waits, and mid-write, and a new engine
// on the same run files carries the ship on.
import { describe, expect, it } from "bun:test";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncResource } from "core/disposable";
import { UuidProvider } from "core/id";
import { MemoryLogger } from "core/log";
import { NodeFs, NodePs } from "core/system";
import { FsStorage } from "../storage";
import { RUNS, ShipEngine } from "./engine";
import type { RunState } from "./run-state";
import { ShellStepProcesses } from "./step-processes";

describe("ShipEngine killed for real", () => {
	it("carries on a step that was mid-flight when the server was killed", async () => {
		await using scene = new Scene();
		await scene.killServerOnce(`"type":"running"`);

		const resumed = await scene.restarted();
		await Bun.sleep(100);
		// The old step process still waits for go, so nothing is asked yet.
		expect(step(await only(resumed), "slow")?.status).toBe("pending");
		scene.go();
		await until(
			async () => step(await only(resumed), "slow")?.status === "skipped",
		);
		await until(
			async () => step(await only(resumed), "ask")?.status === "waiting",
		);
		const run = await only(resumed);
		const prompt = step(run, "ask")?.prompts[0];
		expect(prompt?.prompt).toEqual({ kind: "ask", question: "Code?" });
		await resumed.answer(run.id, "app", "ask", prompt?.id ?? "", "7");
		await until(async () => (await only(resumed)).status === "done");
		expect(scene.code()).toBe("7");
	}, 30_000);

	it("asks again a prompt that waited when the server was killed", async () => {
		await using scene = new Scene();
		scene.go();
		await scene.killServerOnce(`"type":"prompt"`);

		const resumed = await scene.restarted();
		await until(
			async () => step(await only(resumed), "ask")?.status === "waiting",
		);
		const run = await only(resumed);
		expect(step(run, "slow")?.status).toBe("done");
		const prompt = step(run, "ask")?.prompts[0];
		await resumed.answer(run.id, "app", "ask", prompt?.id ?? "", "42");
		await until(async () => (await only(resumed)).status === "done");
		expect(scene.code()).toBe("42");
	}, 30_000);

	it("reads a run file a kill tore mid-write, losing only the torn line", async () => {
		await using scene = new Scene();
		scene.go();
		await scene.killServerOnce(`"type":"prompt"`);
		scene.tear(`{"type":"ended","at":1,"target":"app","step":"ask","outc`);

		const resumed = await scene.restarted();
		await until(
			async () => step(await only(resumed), "ask")?.status === "waiting",
		);
		const run = await only(resumed);
		const prompt = step(run, "ask")?.prompts[0];
		await resumed.answer(run.id, "app", "ask", prompt?.id ?? "", "9");
		await until(async () => (await only(resumed)).status === "done");
	}, 30_000);
});

const FIXTURES = join(import.meta.dir, "fixtures");

/**
 * One test's server, run files and work directory, where the fixture's
 * `app` ships; disposing it kills what it started and removes the files.
 */
class Scene implements AsyncResource, AsyncDisposable {
	readonly #dir = mkdtempSync(join(tmpdir(), "ship-engine-"));
	readonly #storage = join(this.#dir, "storage");
	readonly #cwd = join(this.#dir, "work");
	#server: Bun.Subprocess | null = null;
	#engine: ShipEngine | null = null;

	constructor() {
		mkdirSync(this.#storage);
		mkdirSync(this.#cwd);
	}

	/** Starts a server shipping `app`, and SIGKILLs it once its run file says `seen`. */
	async killServerOnce(seen: string): Promise<void> {
		this.#server = Bun.spawn(
			[
				"bun",
				join(FIXTURES, "engine-server.ts"),
				this.#storage,
				this.#cwd,
				"start",
			],
			{ stdout: "ignore", stderr: "inherit" },
		);
		await until(() => this.#runFile().includes(seen));
		this.#server.kill("SIGKILL");
		await this.#server.exited;
	}

	/** The engine of a server started again on the same run files. */
	async restarted(): Promise<ShipEngine> {
		this.#engine = new ShipEngine({
			storage: new FsStorage(this.#storage, new NodeFs()),
			processes: new ShellStepProcesses(new NodePs(), this.#cwd),
			clock: { now: () => Date.now() },
			ids: new UuidProvider(),
			log: new MemoryLogger(),
			wait: (ms) => Bun.sleep(Math.min(ms, 20)),
		});
		await this.#engine.resume();
		return this.#engine;
	}

	/** Lets the fixture's slow step finish. */
	go(): void {
		writeFileSync(join(this.#cwd, "go"), "");
	}

	/** What the fixture's ask step was given. */
	code(): string {
		return readFileSync(join(this.#cwd, "code"), "utf8");
	}

	/** Ends the run file in `half`, as a kill mid-write leaves it. */
	tear(half: string): void {
		appendFileSync(join(this.#storage, RUNS, this.#runName() ?? ""), half);
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.disposeAsync();
	}

	async disposeAsync(): Promise<void> {
		this.#server?.kill("SIGKILL");
		await this.#engine?.disposeAsync();
		// The fixture's old step processes stop once nothing holds them back.
		this.go();
		rmSync(this.#dir, { recursive: true, force: true });
	}

	#runFile(): string {
		const name = this.#runName();
		return name === undefined
			? ""
			: readFileSync(join(this.#storage, RUNS, name), "utf8");
	}

	#runName(): string | undefined {
		const runs = join(this.#storage, RUNS);
		return existsSync(runs)
			? [...new Bun.Glob("*.jsonl").scanSync(runs)][0]
			: undefined;
	}
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
	for (const deadline = Date.now() + 15_000; Date.now() < deadline; ) {
		if (await check()) {
			return;
		}
		await Bun.sleep(20);
	}
	throw new Error("never came true");
}

async function only(engine: ShipEngine): Promise<RunState> {
	const [run] = await engine.list();
	if (run === undefined) {
		throw new Error("no run");
	}
	return run;
}

function step(run: RunState, id: string) {
	return run.targets[0]?.steps.find((each) => each.id === id);
}
