import { expect, test } from "bun:test";
import { FakeFs } from "core/system/testing";
import { SessionLibrary } from "./sessions";

test("lists newest first with sizes, length and the limit", async () => {
	const { lib } = await library();
	const list = await lib.list();
	expect(list.sessions.map((item) => item.name)).toEqual([
		"calm-jade-fox",
		"brave-copper-otter",
	]);
	expect(list.sessions[1]?.length).toBe(5);
	expect(list.sessions[1]?.topSaid).toBe("the checkout button does nothing");
	expect(list.limit).toBe(100);
	expect(list.totalSize).toBe(
		list.sessions.reduce((sum, item) => sum + item.size, 0),
	);
});

test("shows stills, logs and the timeline, and finds a session by name or folder", async () => {
	const { lib } = await library();
	const detail = await lib.show("brave-copper-otter");
	expect(detail.stills).toEqual([
		"/h/.rec/sessions/2026-01-01/frames/0001-click.jpg",
	]);
	expect(detail.logs).toEqual(["/h/.rec/sessions/2026-01-01/console.log"]);
	expect(detail.timeline).toBe("/h/.rec/sessions/2026-01-01/timeline.md");
	expect(await lib.path("2026-01-01")).toBe("/h/.rec/sessions/2026-01-01");
	expect(lib.path("nope")).rejects.toThrow("No session named nope");
});

test("renames the display name only, refusing a name in use", async () => {
	const { lib, fs } = await library();
	expect(lib.rename("brave-copper-otter", "calm-jade-fox")).rejects.toThrow(
		"in use",
	);
	expect(lib.rename("brave-copper-otter", "Bad Name")).rejects.toThrow();
	await lib.rename("brave-copper-otter", "quiet-azure-wren");
	expect(await lib.path("quiet-azure-wren")).toBe(
		"/h/.rec/sessions/2026-01-01",
	);
	expect(await fs.exists("/h/.rec/sessions/2026-01-01")).toBe(true);
});

test("deletes one session and leaves the rest", async () => {
	const { lib, fs } = await library();
	await lib.delete("calm-jade-fox");
	expect(await fs.exists("/h/.rec/sessions/2026-01-02")).toBe(false);
	expect(await fs.exists("/h/.rec/sessions/2026-01-01")).toBe(true);
});

test("searches names and spoken lines", async () => {
	const { lib } = await library();
	expect(await lib.search("CHECKOUT")).toEqual([
		{
			name: "brave-copper-otter",
			in: "said",
			snippet: "the checkout button does nothing",
		},
	]);
	expect((await lib.search("jade")).map((match) => match.name)).toEqual([
		"calm-jade-fox",
	]);
	expect(await lib.search("zzz")).toEqual([]);
});

test("finds sessions an earlier rec saved but never processed, oldest first, and shows which are pending", async () => {
	const { lib, fs } = await library();
	expect(await lib.unprocessed()).toEqual([]);
	const pending = "/h/.rec/sessions/2026-01-03";
	await fs.mkdir(pending, { recursive: true });
	await fs.write(
		`${pending}/manifest.json`,
		JSON.stringify({
			name: "merry-golden-otter",
			startedAt: 3000,
			stoppedAt: 4000,
			processing: { status: "pending" },
			files: { recording: "recording.webm" },
		}),
	);
	const cutOff = "/h/.rec/sessions/2025-12-31";
	await fs.mkdir(`${cutOff}/.audio`, { recursive: true });
	await fs.write(
		`${cutOff}/manifest.json`,
		JSON.stringify({
			name: "old-cut-off",
			startedAt: 500,
			stoppedAt: 900,
			files: { recording: "recording.webm" },
		}),
	);
	const failed = "/h/.rec/sessions/2026-01-04";
	await fs.mkdir(failed, { recursive: true });
	await fs.write(
		`${failed}/manifest.json`,
		JSON.stringify({
			name: "bad-key",
			startedAt: 5000,
			stoppedAt: 6000,
			processing: { status: "failed", reason: "401", retry: "rec transcribe" },
			files: { recording: "recording.webm" },
		}),
	);
	expect(await lib.unprocessed()).toEqual([
		{ dir: cutOff, name: "old-cut-off" },
		{ dir: pending, name: "merry-golden-otter" },
	]);
	expect((await lib.show("merry-golden-otter")).processing).toEqual({
		status: "pending",
	});
	expect((await lib.show("brave-copper-otter")).processing).toBeUndefined();
});

async function seed(
	fs: FakeFs,
	folder: string,
	name: string,
	startedAt: number,
	said?: string,
) {
	const dir = `/h/.rec/sessions/${folder}`;
	await fs.mkdir(`${dir}/frames`, { recursive: true });
	await fs.write(`${dir}/frames/0001-click.jpg`, "x");
	await fs.write(
		`${dir}/manifest.json`,
		JSON.stringify({
			name,
			startedAt,
			stoppedAt: startedAt + 5000,
			files: {
				frames: "frames",
				timeline: "timeline.md",
				console: "console.log",
			},
		}),
	);
	if (said) {
		await fs.write(
			`${dir}/transcript.json`,
			JSON.stringify({
				utterances: [{ start: 0, end: 1, text: said, words: [] }],
			}),
		);
	}
}

async function library() {
	const fs = new FakeFs();
	await seed(
		fs,
		"2026-01-01",
		"brave-copper-otter",
		1000,
		"the checkout button does nothing",
	);
	await seed(fs, "2026-01-02", "calm-jade-fox", 2000);
	return {
		fs,
		lib: new SessionLibrary(fs, "/h/.rec/sessions", "/h/.rec", { limit: 100 }),
	};
}
