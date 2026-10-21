import { describe, expect, it } from "bun:test";
import { Exit } from "../exit";
import { StateRoutes } from "./state";

const call = (project: object) =>
	new Request("http://127.0.0.1/api/token", {
		method: "POST",
		body: JSON.stringify({ project }),
	});

function routes(opened: string[]): StateRoutes {
	return new StateRoutes({
		ps: {} as never,
		projects: { list: async () => [] } as never,
		named: async (slug) => {
			opened.push(slug);
			return { mintToken: async () => null } as never;
		},
		at: async () => {
			throw new Error("by origin");
		},
	});
}

describe("a relayed call limited to a project", () => {
	it("reaches that project", async () => {
		const opened: string[] = [];
		const response = await routes(opened).token(call({ slug: "a" }), "a");
		expect(response.status).toBe(200);
		expect(opened).toEqual(["a"]);
	});

	it("is refused another project, by slug or by origin", async () => {
		const opened: string[] = [];
		for (const project of [{ slug: "b" }, { origin: "github.com/x/y" }]) {
			const refused = await routes(opened)
				.token(call(project), "a")
				.catch((error: unknown) => error);
			expect(refused).toBeInstanceOf(Exit);
			expect((refused as Exit).reason).toBe("not_granted");
		}
		expect(opened).toEqual([]);
	});

	it("reaches any project when it is limited to none", async () => {
		const opened: string[] = [];
		await routes(opened).token(call({ slug: "b" }), null);
		expect(opened).toEqual(["b"]);
	});
});
