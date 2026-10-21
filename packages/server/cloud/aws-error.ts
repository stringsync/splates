import { AwsXml } from "./aws-xml";

/** An error AWS answered, by its code, as `InvalidInstanceID.NotFound`. */
export class AwsError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
	) {
		super(`AWS ${code}: ${message}`);
	}
}

/**
 * The `AwsError` for a failed Query API answer. A body that is not XML, as a
 * proxy's HTML page or an empty one, reads as its first 200 characters.
 */
export function queryError(text: string, status: number): AwsError {
	let error: ReturnType<typeof AwsXml.parse> = {};
	try {
		error = AwsXml.parse(text);
	} catch {
		// Not XML: the message below is the text itself.
	}
	const found =
		AwsXml.field(AwsXml.field(error.Errors, "Error"), "Code") ??
		AwsXml.field(error.Error, "Code");
	const message =
		AwsXml.field(AwsXml.field(error.Errors, "Error"), "Message") ??
		AwsXml.field(error.Error, "Message");
	return new AwsError(
		AwsXml.str(found) || "Unknown",
		AwsXml.str(message) || text.slice(0, 200),
		status,
	);
}
