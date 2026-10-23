import { describe, expect, it } from "bun:test";
import type { Child } from "webappwiz/system";
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

	it("rejects a successful git response with an empty common directory", async () => {
		const git = new Git("/repo", {
			run: { git: async () => ({ code: 0, stdout: " \n", stderr: "" }) },
		});
		await expect(git.commonDir()).rejects.toThrow("empty path");
	});
});
