import { describe, expect, it } from "bun:test";
import { stretches } from "./asked";
import { recOf, retryOf, shipOf } from "./run-command";

describe("run-command helpers", () => {
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

	it("names the project of a `splates ship`, or none for the conversation's own", () => {
		expect(shipOf("splates ship wren")).toBe("wren");
		expect(shipOf("bin/splates ship")).toBe("");
		expect(shipOf("bunx @stringsync/splates ship mdom")).toBe("mdom");
	});

	it("names no ship for a plan or any other command", () => {
		expect(shipOf("splates ship --plan wren")).toBeNull();
		expect(shipOf("splates ship wren --json")).toBeNull();
		expect(shipOf("splates merge --message x")).toBeNull();
		expect(shipOf("npm ship wren")).toBeNull();
	});

	it("recognizes a rec command, with env words or a path", () => {
		expect(recOf("rec record")).toBe(true);
		expect(recOf("FOO=1 bin/rec bench --fps 30")).toBe(true);
		expect(recOf("bun run build")).toBe(false);
		expect(recOf("splates ship wren")).toBe(false);
	});
});
