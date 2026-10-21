import { expect } from "bun:test";
import type { SpawnOptions } from "webappwiz/system";
import { type FakeFs, FakePs } from "webappwiz/system/testing";

/** An ssh-keygen that writes its public key into a `FakeFs`, counting its runs. */
export class KeygenPs extends FakePs {
	keygens = 0;

	constructor(private readonly fs: FakeFs) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		expect(argv[0]).toBe("ssh-keygen");
		this.keygens++;
		const at = argv.indexOf("-f");
		await this.fs.write(
			`${argv[at + 1]}.pub`,
			"ssh-ed25519 AAAA splates-coordinator\n",
		);
		await this.fs.write(argv[at + 1] ?? "", "PRIVATE KEY\n");
		return { exitCode: 0, stdout: "", stderr: "" };
	}
}
