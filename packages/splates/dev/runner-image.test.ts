import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Cut } from "webappwiz/ship";
import { FakePs } from "webappwiz/system/testing";
import { RunnerImage } from "./runner-image";

describe("the runner image release", () => {
	let ps: FakePs;
	let image: RunnerImage;
	let cut: Cut;

	beforeEach(() => {
		ps = new FakePs();
		image = new RunnerImage(ps);
		cut = new Cut("0.0.55", [], { root: "/release", log: new MemoryLogger() });
	});

	it("publishes the release's Linux image and latest after the packages", async () => {
		await image.publish(cut);
		expect(image.stage).toBe("publish");
		expect(ps.getCalls()).toEqual([
			"docker buildx build --platform linux/amd64 --file docker/runner.Dockerfile --build-arg SPLATES_VERSION=0.0.55 --tag ghcr.io/stringsync/splates-runner:0.0.55 --tag ghcr.io/stringsync/splates-runner:latest --push .",
		]);
		expect(ps.getCallDirs()).toEqual(["/release"]);
	});

	it("stops the release when the image cannot be published", async () => {
		ps.simulate(async () => 1);
		await expect(image.publish(cut)).rejects.toThrow("rerun splates dev ship");
	});
});
