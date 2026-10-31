import type { StartOptions } from "core/system";
import { FakeChild, FakePs } from "core/system/testing";

/** A git command exits on its own, unlike a protocol child a test drives. */
export class FakeGitPs extends FakePs {
	override start(argv: string[], opts?: StartOptions): FakeChild {
		const child = new FakeChild();
		void this.spawnCapture(argv, opts).then(({ exitCode, stdout, stderr }) => {
			child.print(stdout);
			child.printError(stderr);
			child.exit(exitCode);
		});
		return child;
	}
}
