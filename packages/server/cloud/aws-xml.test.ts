import { describe, expect, it } from "bun:test";
import { AwsXml } from "./aws-xml";

describe("AwsXml", () => {
	it("reads an answer with the declaration on a line of its own, as AWS sends it", () => {
		const text = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<DescribeSubnetsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">',
			"    <requestId>r1</requestId>",
			"    <subnetSet>",
			"        <item><subnetId>subnet-1</subnetId><vpcId>vpc-1</vpcId></item>",
			"    </subnetSet>",
			"</DescribeSubnetsResponse>",
			"",
		].join("\n");

		const answer = AwsXml.parse(text);

		expect(AwsXml.str(answer.requestId)).toBe("r1");
		expect(
			AwsXml.str(AwsXml.field(AwsXml.list(answer.subnetSet)[0], "subnetId")),
		).toBe("subnet-1");
	});

	it("reads an error answer and decodes its entities", () => {
		const text =
			'<?xml version="1.0" encoding="UTF-8"?>\n<Response><Errors><Error><Code>UnauthorizedOperation</Code><Message>You &amp; me</Message></Error></Errors></Response>';

		const error = AwsXml.field(AwsXml.parse(text).Errors, "Error");

		expect(AwsXml.str(AwsXml.field(error, "Code"))).toBe(
			"UnauthorizedOperation",
		);
		expect(AwsXml.str(AwsXml.field(error, "Message"))).toBe("You & me");
	});

	it("refuses what is not XML", () => {
		expect(() => AwsXml.parse('{"message":"no"}')).toThrow(
			"AWS answered XML splates cannot read",
		);
	});
});
