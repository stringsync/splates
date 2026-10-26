import { describe, expect, it } from "bun:test";
import { stretches } from "./asked";
import { retryOf } from "./run-command";

describe("a run-command permission card", () => {
	it("takes its command from the first backticked line", () => {
		const [stretch] = stretches(
			"## 🔐 Permission: run command: build the web app\n\n`bun run build`\n\nTakes about two minutes.",
		).filter((each) => each.type === "permission");
		expect(stretch).toMatchObject({
			permission: {
				action: "run-command",
				title: "build the web app",
				command: "bun run build",
				body: "Takes about two minutes.",
			},
		});
	});

	it("names the task of a `splates retry`, however splates is run, for its retry card", () => {
		expect(retryOf("splates retry upload-413")).toBe("upload-413");
		expect(retryOf("bin/splates retry upload-413")).toBe("upload-413");
		expect(retryOf("bunx @stringsync/splates retry upload-413")).toBe(
			"upload-413",
		);
	});

	it("names no task for any other command", () => {
		expect(retryOf("splates merge --message x")).toBeNull();
		expect(retryOf("splates retry")).toBeNull();
		expect(retryOf("git retry upload-413")).toBeNull();
	});
});
