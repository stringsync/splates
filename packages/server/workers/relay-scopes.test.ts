import { describe, expect, it } from "bun:test";
import { RelayScopes } from "./relay-scopes";

describe("relay scopes", () => {
	it("limits a connection to its project until it is released", () => {
		const scopes = new RelayScopes();
		const held = scopes.hold(5000, "a");
		expect(scopes.of(5000)).toBe("a");
		expect(scopes.of(5001)).toBeNull();
		expect(scopes.of(undefined)).toBeNull();
		held.dispose();
		expect(scopes.of(5000)).toBeNull();
	});

	it("keeps a reused port's new project when the old connection releases late", () => {
		const scopes = new RelayScopes();
		const old = scopes.hold(5000, "a");
		scopes.hold(5000, "b");
		old.dispose();
		expect(scopes.of(5000)).toBe("b");
	});
});
