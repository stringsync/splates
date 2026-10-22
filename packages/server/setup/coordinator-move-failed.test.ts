import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { failedMove, moveFiles } from "./coordinator-move";

const HOME = "/home/.splates";
const FILES = moveFiles(HOME);

describe("failedMove", () => {
	it("says what a failed deploy said, and nothing for one that did not fail", async () => {
		const fs = new FakeFs();
		expect(await failedMove({ fs, home: HOME })).toBeNull();

		await fs.write(FILES.exit, "1\n");
		await fs.write(
			FILES.log,
			"starting splates server on the box\nerror: 502\n",
		);
		expect(await failedMove({ fs, home: HOME })).toBe(
			"The last deploy failed (exit 1) after stopping this server, which is why you restarted it. It said:\n\nstarting splates server on the box\nerror: 502",
		);

		await fs.write(FILES.exit, "0\n");
		expect(await failedMove({ fs, home: HOME })).toBeNull();
	});
});
