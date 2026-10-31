export function base64url(bytes: Uint8Array): string {
	return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
}

export function bytesOf(text: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.fromBase64(text, { alphabet: "base64url" });
}
