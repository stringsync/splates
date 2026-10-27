import { describe, expect, it } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import { requestError } from "./errors";

describe("requestError", () => {
	it("tells a signed-out Kimi to run kimi login", () => {
		const error = acp.RequestError.authRequired();
		expect(requestError(error, "kimi")).toContain("Run `kimi login`");
		expect(requestError(error, "claude")).not.toContain("login");
		expect(requestError(new Error("Internal error"), "kimi")).toBe(
			"Internal error",
		);
	});
});
