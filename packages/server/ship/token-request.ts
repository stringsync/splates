/** The creds name a ship publishes under when the store keeps one. */
export const NPM_TOKEN = "NPM_TOKEN";

/** Why a ship asks for the token. */
const NPM_TOKEN_PURPOSE =
	"For a ship to publish to npm without the web login, so it can be approved from a phone.";

/**
 * How to make the token. Stage-only, not 2FA-bypass: npm removes direct
 * publishing with bypass tokens in January 2027, and a ship publishes staged.
 */
const NPM_TOKEN_INSTRUCTIONS = `1. Open npmjs.com, then your avatar, **Access Tokens**, **Generate New Token**, **Granular Access Token**.
2. Under **Packages and scopes**, choose **Read and write (stage only)** and select the packages this project ships.
3. Under **Allowed IP ranges**, add the public IP range of the machine \`splates server\` runs on.
4. Do not pick a token that bypasses 2FA: npm removes direct publishing with those in January 2027. A ship stages the release and you approve it on npm.
5. Generate it and paste it here.`;

/** Asks for the `NPM_TOKEN` in `creds`' device store, and nothing when it is kept. */
export async function requestNpmToken(creds: {
	request: (
		name: string,
		options: {
			scope: "device";
			purpose: string;
			instructions: string;
			task: null;
		},
	) => Promise<unknown>;
}): Promise<void> {
	await creds.request(NPM_TOKEN, {
		scope: "device",
		purpose: NPM_TOKEN_PURPOSE,
		instructions: NPM_TOKEN_INSTRUCTIONS,
		task: null,
	});
}
