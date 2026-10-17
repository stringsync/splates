import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { Setup } from "./setup";
import { SETUP_AREAS } from "./setup-areas";

describe("SETUP_AREAS", () => {
	it("leaves every step on a fresh machine, each ready once its prerequisites are", async () => {
		const progress = await new Setup(
			{
				fs: new FakeFs(),
				home: "/home/.splates",
				device: new FakeSecretStore(),
			},
			SETUP_AREAS,
		).read();

		const steps = progress.areas.flatMap((area) => area.steps);

		expect(steps.map((step) => [step.id, step.status])).toEqual(
			steps.map((step) => [
				step.id,
				step.after.length === 0 ? "ready" : "waiting",
			]),
		);
		expect(progress.next).toBe("agent-roster");
		expect(progress.required).toBe(true);
	});

	it("lists the agents first, and each journey once", () => {
		expect(SETUP_AREAS.map((area) => area.id)).toEqual([
			"agents",
			"opencode",
			"remote-access",
			"notifications",
			"dictation",
			"claude",
			"codex",
		]);
	});
});
