import { describe, expect, it } from "bun:test";
import { Worker } from "node:worker_threads";
import { type Child, NodePs } from "webappwiz/system";
import { Git } from "./git";
import { processGit } from "./git-process";

class DrainingProcess {
	readonly output = new TransformStream<Uint8Array>();
	readonly errors = new TransformStream<Uint8Array>();
	readonly input = new WritableStream<Uint8Array>();

	start(): Child {
		return {
			pid: null,
			stdin: this.input,
			stdout: this.output.readable,
			stderr: this.errors.readable,
			exited: Promise.resolve(0),
			kill() {},
		};
	}
}

describe("processGit", () => {
	it("drains both pipes even when the process has already exited", async () => {
		const ps = new DrainingProcess();
		const result = processGit(ps).git("/repo", ["rev-parse"]);
		// The exit promise settles before either pipe has supplied its data.
		await Promise.resolve();
		const output = ps.output.writable.getWriter();
		const errors = ps.errors.writable.getWriter();
		await output.write(new TextEncoder().encode("/repo/.git\n"));
		await output.close();
		await errors.write(new TextEncoder().encode("warning\n"));
		await errors.close();
		expect(await result).toEqual({
			code: 0,
			stdout: "/repo/.git\n",
			stderr: "warning\n",
		});
		expect(ps.input.locked).toBe(false);
	});

	it("returns the output when git exits before its stdin closes", async () => {
		const ps = new DrainingProcess();
		const input = new WritableStream<Uint8Array>({
			close() {
				throw new Error("Premature close");
			},
		});
		const child = ps.start();
		const result = processGit({
			start: () => ({ ...child, stdin: input }),
		}).git("/repo", ["rev-parse"]);
		await ps.output.writable.close();
		await ps.errors.writable.close();
		expect(await result).toEqual({ code: 0, stdout: "", stderr: "" });
	});

	it("rejects a successful git response with an empty common directory", async () => {
		const git = new Git("/repo", {
			run: { git: async () => ({ code: 0, stdout: " \n", stderr: "" }) },
		});
		await expect(git.commonDir()).rejects.toThrow("empty path");
	});

	// scry-ignore simple-test-setup: Only this regression uses workers and their synchronization; there is no shared setup to move.
	it("keeps concurrent workers' git output separate even though they share a pid", async () => {
		const module = new URL("./git-process.ts", import.meta.url).href;
		const code = `
			const { parentPort, workerData } = require("node:worker_threads");
			(async () => {
				const { processGit } = await import(workerData.module);
				const { NodePs } = await import("webappwiz/system");
				parentPort.postMessage("ready");
				parentPort.once("message", async () => {
					try {
						parentPort.postMessage(await processGit(new NodePs()).git("/", [
							"-c", "alias.marker=!echo " + workerData.marker + "; sleep 0.1", "marker"
						]));
					} catch (error) {
						parentPort.postMessage({ error: String(error) });
					} finally {
						parentPort.close();
					}
				});
			})();`;
		const workers = ["alpha", "beta"].map(
			(marker) =>
				new Worker(code, { eval: true, workerData: { module, marker } }),
		);
		try {
			await Promise.all(workers.map(nextMessage));
			const results = workers.map(nextMessage);
			workers.forEach((worker) => {
				worker.postMessage("go");
			});
			expect(await Promise.all(results)).toEqual([
				{ code: 0, stdout: "alpha\n", stderr: "" },
				{ code: 0, stdout: "beta\n", stderr: "" },
			]);
		} finally {
			await Promise.all(workers.map((worker) => worker.terminate()));
		}
	});

	it("returns real git output and failures through NodePs", async () => {
		const runner = processGit(new NodePs());
		const version = await runner.git("/", ["--version"]);
		expect(version.code).toBe(0);
		expect(version.stdout).toStartWith("git version");
		expect(version.stderr).toBe("");

		const missing = await runner.git("/nonexistent-splates-dir", [
			"rev-parse",
			"HEAD",
		]);
		expect(missing.code).not.toBe(0);
		expect(missing.stderr).toContain("nonexistent-splates-dir");
	});
});

/** One worker response, surfacing a worker crash rather than waiting forever. */
function nextMessage(worker: Worker): Promise<unknown> {
	return new Promise((resolve, reject) => {
		worker.once("message", resolve);
		worker.once("error", reject);
	});
}
