import { describe, expect, it } from "bun:test";
import { queryError } from "./aws-error";

describe("queryError", () => {
	it("reads the code and message of an XML answer", () => {
		const error = queryError(
			'<?xml version="1.0"?>\n<Response><Errors><Error><Code>AuthFailure</Code><Message>bad key</Message></Error></Errors></Response>',
			401,
		);
		expect(error.code).toBe("AuthFailure");
		expect(error.message).toBe("AWS AuthFailure: bad key");
		expect(error.status).toBe(401);
	});

	it("reads a body that is not XML as its first 200 characters", () => {
		const html = `<html>${"x".repeat(300)}`;
		const errors = [html, "{}", ""].map((text) => {
			const { code, message, status } = queryError(text, 502);
			return { code, message, status };
		});
		expect(errors).toEqual([
			{
				code: "Unknown",
				message: `AWS Unknown: ${html.slice(0, 200)}`,
				status: 502,
			},
			{ code: "Unknown", message: "AWS Unknown: {}", status: 502 },
			{ code: "Unknown", message: "AWS Unknown: ", status: 502 },
		]);
	});
});
