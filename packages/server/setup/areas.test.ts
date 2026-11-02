import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "core/creds/testing";
import { FakeFs } from "core/system/testing";
import { SETUP_AREAS } from "./areas";
import { Setup } from "./setup";

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
		expect(progress.next).toBe("claude-install");
		expect(progress.required).toBe(false);
	});

	it("lists each journey once, the agents first", () => {
		expect(SETUP_AREAS.map((area) => area.id)).toEqual([
			"claude",
			"codex",
			"kimi",
			"opencode",
			"remote-access",
			"replica",
			"dictation",
			"evals",
			"ships",
			"auto-pick",
		]);
	});
});
