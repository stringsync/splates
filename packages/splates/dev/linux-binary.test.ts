import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Cut } from "webappwiz/ship";
import { FakePs } from "webappwiz/system/testing";
import { LinuxBinary } from "./linux-binary";
import { LinuxBinaryBuild } from "./linux-binary-build";

describe("the linux binary release", () => {
	let ps: FakePs;
	let binary: LinuxBinary;
	let cut: Cut;

	beforeEach(() => {
		ps = new FakePs();
		binary = new LinuxBinary(ps);
		cut = new Cut("0.0.55", [], { root: "/release", log: new MemoryLogger() });
	});

	it("builds and checksums the binary in the build stage", async () => {
		const build = new LinuxBinaryBuild(ps);
		await build.publish(cut);
		expect(build.stage).toBe("build");
		expect(ps.getCalls()).toEqual([
			"bun build --compile --target=bun-linux-x64 packages/splates/index.ts --outfile /release/dist/splates-linux-x64",
			"sh -c cd dist && sha256sum splates-linux-x64 > splates-linux-x64.sha256",
		]);
	});

	it("attaches the binary and checksum to the tag's release", async () => {
		await binary.publish(cut);
		expect(ps.getCalls()).toEqual([
			"gh release upload v0.0.55 /release/dist/splates-linux-x64 /release/dist/splates-linux-x64.sha256 --clobber",
		]);
	});

	it("stops the release when a step fails", async () => {
		ps.simulate(async () => 1);
		await expect(binary.publish(cut)).rejects.toThrow("rerun splates dev ship");
	});
});
