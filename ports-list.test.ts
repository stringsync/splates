import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { portsLs } from "./ports-list";

describe("arbor ports", () => {
	it("asks the arbor dev it runs under, and gives a task's remote and local links", async () => {
		const { said, asked } = await ports("alpha");

		expect(asked).toEqual(["http://localhost:4310/api/ports"]);
		expect(said).toContain("https://alpha-5173.ports.example.com");
		expect(said).toContain("http://localhost:5173");
		expect(said).not.toContain("beta");
	});

	it("says how to serve them remotely when no ports host is saved", async () => {
		const { said } = await ports("", {
			base: null,
			ports: [{ ...listed.ports[0], remote: null }],
		});

		expect(said).toContain("--ports-host");
	});

	it("says when a task serves nothing yet", async () => {
		const { said } = await ports("gamma");

		expect(said).toContain("'gamma' serves no port now");
	});
});

const listed = {
	base: "ports.example.com",
	ports: [
		{
			task: "alpha",
			port: 5173,
			local: "http://localhost:5173",
			remote: "https://alpha-5173.ports.example.com",
		},
		{
			task: "beta",
			port: 3000,
			local: "http://localhost:3000",
			remote: "https://beta-3000.ports.example.com",
		},
	],
};

async function ports(task: string, answer: object = listed) {
	const log = new MemoryLogger();
	const asked: string[] = [];
	const ps = new FakePs();
	ps.setEnv({ ARBOR_DEV: "http://localhost:4310" });
	await portsLs({
		task,
		dev: "",
		json: false,
		log,
		ps,
		send: (async (url: URL) => {
			asked.push(String(url));
			return Response.json(answer);
		}) as unknown as typeof fetch,
	});
	return {
		said: log.entries.map((each) => String(each.message)).join("\n"),
		asked,
	};
}
