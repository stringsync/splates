import { describe, expect, it } from "bun:test";
import { ACCESS_HEADER } from "./access";
import { FakeAccess } from "./testing";

describe("Access with a service token", () => {
	it("verifies the token Access hands a worker on, which names no one's email", async () => {
		const fake = await FakeAccess.make();
		const request = new Request("https://splates.example.com/api/workers", {
			headers: { [ACCESS_HEADER]: await fake.serviceToken("client.access") },
		});

		expect(await fake.access.verify(request)).toEqual({
			identity: { email: null, sub: "" },
		});
	});
});
