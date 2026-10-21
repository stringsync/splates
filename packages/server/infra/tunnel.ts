import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

export interface TunnelArgs {
	/** The public host name, in a zone of the account. */
	host: string;
	/** The email address Access lets in. */
	email: string;
	/** The Cloudflare account's id. */
	accountId: pulumi.Input<string>;
	/** The id of the zone `host` is in. */
	zoneId: pulumi.Input<string>;
}

/**
 * What `splates tunnel setup` makes through the API, as resources: a named
 * tunnel, the DNS record routing `host` to it, an Access application letting
 * in `email`, and the service token workers pass Access with. The tunnel's
 * token is an output for the box's creds, never printed on a laptop.
 */
export class Tunnel extends pulumi.ComponentResource {
	readonly host: string;
	readonly token: pulumi.Output<string>;
	/** The tunnel's id, which the box's `tunnel.json` names. */
	readonly tunnelId: pulumi.Output<string>;
	/** The Zero Trust team, as in `<team>.cloudflareaccess.com`. */
	readonly team: pulumi.Output<string>;
	/** The AUD tag of the Access application in front of `host`. */
	readonly aud: pulumi.Output<string>;
	readonly serviceTokenId: pulumi.Output<string>;
	readonly serviceTokenSecret: pulumi.Output<string>;

	constructor(
		name: string,
		args: TunnelArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("splates:infra:Tunnel", name, {}, opts);
		const child = { parent: this };

		const secret = new random.RandomBytes(
			`${name}-secret`,
			{ length: 32 },
			child,
		);
		const tunnel = new cloudflare.ZeroTrustTunnelCloudflared(
			`${name}-tunnel`,
			{
				accountId: args.accountId,
				// Not `name` alone: `splates tunnel setup` names this Mac's tunnel
				// `splates`, which still serves until the box takes over.
				name: `${name}-coordinator`,
				tunnelSecret: secret.base64,
				configSrc: "cloudflare",
			},
			child,
		);
		new cloudflare.ZeroTrustTunnelCloudflaredConfig(
			`${name}-config`,
			{
				accountId: args.accountId,
				tunnelId: tunnel.id,
				config: {
					ingresses: [
						{ hostname: args.host, service: "http://localhost:7272" },
						{ service: "http_status:404" },
					],
				},
			},
			child,
		);
		new cloudflare.DnsRecord(
			`${name}-dns`,
			{
				zoneId: args.zoneId,
				name: args.host,
				type: "CNAME",
				content: pulumi.interpolate`${tunnel.id}.cfargotunnel.com`,
				proxied: true,
				ttl: 1,
			},
			child,
		);

		const serviceToken = new cloudflare.ZeroTrustAccessServiceToken(
			`${name}-service-token`,
			{ accountId: args.accountId, name: `${name} workers` },
			child,
		);
		const people = new cloudflare.ZeroTrustAccessPolicy(
			`${name}-people`,
			{
				accountId: args.accountId,
				name: `${name} people`,
				decision: "allow",
				includes: [{ email: { email: args.email } }],
			},
			child,
		);
		const workers = new cloudflare.ZeroTrustAccessPolicy(
			`${name}-workers`,
			{
				accountId: args.accountId,
				name: `${name} workers`,
				decision: "non_identity",
				includes: [{ serviceToken: { tokenId: serviceToken.id } }],
			},
			child,
		);
		const access = new cloudflare.ZeroTrustAccessApplication(
			`${name}-access`,
			{
				accountId: args.accountId,
				name,
				domain: args.host,
				type: "self_hosted",
				policies: [{ id: people.id }, { id: workers.id }],
			},
			child,
		);

		const organization = cloudflare.getZeroTrustOrganizationOutput(
			{ accountId: args.accountId },
			child,
		);

		this.host = args.host;
		this.tunnelId = tunnel.id;
		this.team = organization.authDomain.apply((domain) =>
			(domain ?? "").replace(/\.cloudflareaccess\.com$/, ""),
		);
		this.aud = access.aud;
		this.token = pulumi.secret(
			pulumi
				.all([tunnel.id, secret.base64, args.accountId])
				.apply(([id, tunnelSecret, account]) =>
					Buffer.from(
						JSON.stringify({ a: account, t: id, s: tunnelSecret }),
					).toString("base64"),
				),
		);
		this.serviceTokenId = serviceToken.clientId;
		this.serviceTokenSecret = pulumi.secret(serviceToken.clientSecret);
		this.registerOutputs({
			host: this.host,
			token: this.token,
			tunnelId: this.tunnelId,
			team: this.team,
			aud: this.aud,
			serviceTokenId: this.serviceTokenId,
			serviceTokenSecret: this.serviceTokenSecret,
		});
	}
}
