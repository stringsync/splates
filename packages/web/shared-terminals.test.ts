import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SharedTerminals } from "./shared-terminals";
import { Terminals } from "./terminals";

describe("terminals shared across devices", () => {
	let shared: SharedTerminals;
	let terminals: Terminals;

	beforeEach(() => {
		localStorage.clear();
		shared = new SharedTerminals();
		terminals = new Terminals(localStorage, () => false, { shared });
	});

	afterEach(() => {
		terminals.dispose();
	});

	it("lists a main-tree terminal another device opened, in order, with its name", () => {
		shared.said([
			{ key: "terminal/2", name: "build" },
			{ key: "terminal/1", name: null },
		]);

		expect(terminals.mains).toEqual(["terminal/1", "terminal/2"]);
		expect(terminals.nameOf("terminal/2")).toBe("build");
		expect(terminals.nameOf("terminal/1")).toBe("Terminal 1");
	});

	it("drops a terminal another device closed, and keeps one this page just made", () => {
		shared.said([{ key: "terminal/1", name: null }]);
		const made = terminals.another();
		expect(made).toBe("terminal/2");

		shared.said([]);

		expect(terminals.mains).toEqual(["terminal/2"]);
	});

	it("nests a conversation's terminal another device started under it", () => {
		shared.said([{ key: "c1", name: null }]);

		expect(terminals.up()).toEqual(["c1"]);
		expect(terminals.running("c1")).toBe(true);

		shared.said([]);

		expect(terminals.up()).toEqual([]);
	});

	it("follows the server's name over the one it kept", () => {
		shared.said([{ key: "terminal/1", name: "old" }]);
		terminals.rename("terminal/1", "mine");
		shared.said([{ key: "terminal/1", name: null }]);

		expect(terminals.nameOf("terminal/1")).toBe("Terminal 1");
	});
});
