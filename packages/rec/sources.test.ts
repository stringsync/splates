import { expect, test } from "bun:test";
import {
	appendFile,
	mkdtemp,
	rename,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { Duration, sleep } from "core/time";
import { composeProject, parseContainers, selectContainers } from "./docker";
import { guessLevel, parseStamp, sourceLine } from "./sources";
import { parseTailSpec, Tail } from "./tail";

test("a line's own time is read in the forms logs use", () => {
	expect(parseStamp("2026-11-03T12:00:00.123Z hello")).toEqual({
		at: Date.parse("2026-11-03T12:00:00.123Z"),
		rest: "hello",
	});
	expect(parseStamp("2026-11-03T12:00:00.123456789Z x")?.at).toBe(
		Date.parse("2026-11-03T12:00:00.123Z"),
	);
	expect(parseStamp("[2026-11-03 12:00:00,5] x")?.rest).toBe("x");
	expect(parseStamp("no time here")).toBeUndefined();
});

test("lines get a guessed level", () => {
	expect(guessLevel("ERROR db down")).toBe("error");
	expect(guessLevel("warn: slow")).toBe("warn");
	expect(guessLevel("listening")).toBe("info");
	expect(sourceLine(0, "ERROR x")).toBe(
		"1970-01-01T00:00:00.000Z ERROR ERROR x",
	);
});

test("tail specs take a backfill", () => {
	expect(parseTailSpec("/a/b.log")).toEqual({
		path: "/a/b.log",
		backfillMs: 0,
	});
	expect(parseTailSpec("/a/b.log@-5m")).toEqual({
		path: "/a/b.log",
		backfillMs: 300_000,
	});
	expect(() => parseTailSpec("/a@-5x")).toThrow();
});

test("a bare --docker takes the Compose project of the cwd, else everything", () => {
	const all = parseContainers("a1\tweb\tmono\nb2\tdb\tmono\nc3\tother\t\n");
	expect(composeProject("/x/Mono")).toBe("mono");
	expect(
		selectContainers(all, "true", "/x/mono").map((box) => box.name),
	).toEqual(["web", "db"]);
	expect(selectContainers(all, "true", "/x/none")).toHaveLength(3);
	expect(selectContainers(all, "c3,web", "/x").map((box) => box.name)).toEqual([
		"web",
		"other",
	]);
	expect(() => selectContainers(all, "zzz", "/x")).toThrow(
		"no running container",
	);
});

test("tail follows appends, truncation and rotation, and backfills", async () => {
	const dir = await mkdtemp(`${tmpdir()}/rec-tail-`);
	const path = `${dir}/app.log`;
	const now = Date.parse("2026-11-03T12:10:00Z");
	await writeFile(
		path,
		"2026-11-03T12:00:00Z old\n2026-11-03T12:07:00Z recent\ncontinued\n",
	);
	const seen: [number, string][] = [];
	const tail = await Tail.start({
		path,
		backfillMs: 5 * 60_000,
		now: () => now,
		sink: { line: (at, text) => seen.push([at, text]) },
		poll: Duration.ms(10),
	});
	try {
		expect(seen.map(([, line]) => line)).toEqual(["recent", "continued"]);
		expect(seen[1]?.[0]).toBe(Date.parse("2026-11-03T12:07:00Z"));
		await appendFile(path, "new line\nhalf");
		await sleep(Duration.ms(80));
		expect(seen.at(-1)).toEqual([now, "new line"]);
		await appendFile(path, " done\n");
		await sleep(Duration.ms(80));
		expect(seen.at(-1)?.[1]).toBe("half done");
		await truncate(path, 0);
		await appendFile(path, "after truncate\n");
		await sleep(Duration.ms(80));
		expect(seen.at(-1)?.[1]).toBe("after truncate");
		await rename(path, `${path}.1`);
		await writeFile(path, "after rotate, a longer line than before it\n");
		await sleep(Duration.ms(80));
		expect(seen.at(-1)?.[1]).toBe("after rotate, a longer line than before it");
	} finally {
		tail.dispose();
	}
});
