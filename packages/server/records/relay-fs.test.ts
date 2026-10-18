import { describe, expect, it } from "bun:test";
import { RelayFs } from "./relay-fs";

describe("relay fs", () => {
	it("reads a file the coordinator answers as missing as ENOENT", async () => {
		const fs = new RelayFs(
			"http://coordinator",
			{ slug: "p" },
			"/w/.git/splates",
			async () =>
				Response.json(
					{ missing: true, message: "ENOENT: no such file" },
					{ status: 404 },
				),
		);

		await expect(fs.read("/w/.git/splates/tasks/a.json")).rejects.toMatchObject(
			{ code: "ENOENT" },
		);
	});

	it("still throws the message of any other refusal", async () => {
		const fs = new RelayFs(
			"http://coordinator",
			{ slug: "p" },
			"/w/.git/splates",
			async () => Response.json({ message: "nope" }, { status: 500 }),
		);

		await expect(fs.read("/w/.git/splates/x")).rejects.toThrow("nope");
	});
});
