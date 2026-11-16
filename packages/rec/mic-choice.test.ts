import { expect, test } from "bun:test";
import { FakeFs } from "core/system/testing";
import { MicChoice } from "./mic-choice";

test("remembers the chosen mic's label for the next launch", async () => {
	const fs = new FakeFs();
	await new MicChoice(fs, "/rec/mic.json").write("MacBook Pro Microphone");
	expect(await new MicChoice(fs, "/rec/mic.json").read()).toBe(
		"MacBook Pro Microphone",
	);
});

test("reads nothing when no mic was saved or the file is not ours", async () => {
	const fs = new FakeFs();
	expect(await new MicChoice(fs, "/rec/mic.json").read()).toBeUndefined();
	await fs.write("/rec/mic.json", "not json");
	expect(await new MicChoice(fs, "/rec/mic.json").read()).toBeUndefined();
});
