import type { HeavyCap } from "webappwiz/system";
import type { FakeChild, FakePs } from "webappwiz/system/testing";

/** Lets a `SharedBrowser`'s awaits run until it has started its `count`th MCP. */
export async function served(
	ps: FakePs,
	count = 1,
): Promise<FakeChild | undefined> {
	while (ps.getChildren().length < count) {
		await Bun.sleep(1);
	}
	return ps.getChildren()[count - 1];
}

/** A cap with a slot always free. */
export const FREE: HeavyCap = {
	take: async () => ({ env: {}, [Symbol.asyncDispose]: async () => {} }),
	read: async () => ({ cap: 1, running: [], waiting: [] }),
};
