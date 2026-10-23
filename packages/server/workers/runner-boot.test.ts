import { expect, test } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { SplatesRunnerBoot } from "./runner-boot";

test("a runner boots the project's own image when it names one", async () => {
	const boot = new SplatesRunnerBoot(new FakePs(), { image: "ghcr.io/me/ci" });
	expect(await boot.image()).toBe("ghcr.io/me/ci");
});
