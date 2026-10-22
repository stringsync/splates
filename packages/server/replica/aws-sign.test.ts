import { describe, expect, it } from "bun:test";
import { AwsSigner } from "./aws-sign";

describe("AwsSigner", () => {
	it("signs as AWS's documented example does", () => {
		const signer = new AwsSigner(
			{
				accessKeyId: "AKIDEXAMPLE",
				secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
			},
			"us-east-1",
			"iam",
		);

		const headers = signer.sign(
			{
				method: "GET",
				url: new URL(
					"https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
				),
				headers: {
					"Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
				},
				body: "",
			},
			new Date("2015-08-30T12:36:00Z"),
		);

		expect(headers.Authorization).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
		);
	});

	it("signs a session token too", () => {
		const signer = new AwsSigner(
			{ accessKeyId: "A", secretAccessKey: "S", sessionToken: "T" },
			"us-east-1",
			"ec2",
		);

		const headers = signer.sign(
			{
				method: "POST",
				url: new URL("https://ec2.us-east-1.amazonaws.com/"),
				headers: {},
				body: "a=b",
			},
			new Date(0),
		);

		expect(headers["x-amz-security-token"]).toBe("T");
		expect(headers.Authorization).toContain("x-amz-security-token");
	});
});
