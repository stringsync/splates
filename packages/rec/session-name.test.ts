import { expect, test } from "bun:test";
import { FakeFs } from "core/system/testing";
import { SessionNames, sessionName, suggestName } from "./session-name";

test.each(["otter", "brave-copper-otter"])("accepts %s", (name) => {
	expect(sessionName.safeParse(name).success).toBe(true);
});
test.each(["", "A", "two words", "a--b", "-a", "a-", "../a", "name-2"])(
	"rejects %s",
	(name) => {
		expect(sessionName.safeParse(name).success).toBe(false);
	},
);

test("suggestions skip occupied names and terminate when the vocabulary is exhausted", () => {
	const used = new Set<string>();
	Array.from({ length: 1728 }, () => used.add(suggestName(used, () => 0)));
	expect(used.size).toBe(1728);
	expect(() => suggestName(used)).toThrow("All session names");
});

test("identity is read from the manifest even when the folder has another name", async () => {
	const fs = new FakeFs();
	await fs.mkdir("/sessions/stamp", { recursive: true });
	await fs.write(
		"/sessions/stamp/manifest.json",
		JSON.stringify({ name: "brave-copper-otter" }),
	);
	await fs.mkdir("/sessions/legacy", { recursive: true });
	const used = await new SessionNames(fs).used("/sessions");
	expect(used.has("brave-copper-otter")).toBe(true);
	expect(used.has("legacy")).toBe(true);
	expect(suggestName(used, () => 0)).not.toBe("brave-copper-otter");
});

test("custom output sessions reserve their manifest names and release them on deletion", async () => {
	const fs = new FakeFs();
	await fs.mkdir("/home/.rec", { recursive: true });
	await fs.mkdir("/custom", { recursive: true });
	await fs.write(
		"/custom/manifest.json",
		JSON.stringify({ name: "calm-amber-fox" }),
	);
	const names = new SessionNames(fs);
	await names.remember("/home/.rec", "/custom");
	expect(await names.available("/home/.rec", "/home")).toContain(
		"calm-amber-fox",
	);
	expect(
		names.choose(new Set(["calm-amber-fox"]), "calm-amber-fox"),
	).rejects.toThrow("already in use");
	await fs.rm("/custom", { recursive: true });
	expect(await names.available("/home/.rec", "/home")).not.toContain(
		"calm-amber-fox",
	);
});
