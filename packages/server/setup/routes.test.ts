import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "core/creds/testing";
import { FakeFs } from "core/system/testing";
import { DICTATION_AREA } from "./area-dictation";
import { SetupRoutes } from "./routes";
import { Setup, type SetupMachine, type SetupProgress } from "./setup";

const HOME = "/home/.splates";

function post(path: string): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ answers: {} }),
	});
}

describe("SetupRoutes", () => {
	let routes: SetupRoutes;

	beforeEach(async () => {
		const machine: SetupMachine = {
			fs: new FakeFs(),
			home: HOME,
			device: new FakeSecretStore(),
		};
		await machine.fs.mkdir(HOME, { recursive: true });
		routes = new SetupRoutes(async () => new Setup(machine, [DICTATION_AREA]));
	});

	it("reads the setup and presses a step's Next", async () => {
		const fresh = (await (
			await routes.read(new Request("http://localhost/api/setup"))
		).json()) as SetupProgress;
		const unsaved = await routes.next(post("/api/setup/dictation/next"));

		expect(fresh.next).toBe("dictation");
		expect(unsaved.status).toBe(422);
		expect(await unsaved.json()).toEqual({
			reason: "step",
			message: "Paste the OpenAI API key first.",
		});
		expect(routes.next(post("/api/setup/nope/next"))).rejects.toMatchObject({
			reason: "not_found",
		});
	});
});
