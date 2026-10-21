import * as pulumi from "@pulumi/pulumi";
import {
	CoordinatorBox,
	DeployKeys,
	Tunnel,
} from "@stringsync/splates-server/infra";

const config = new pulumi.Config("splates");
const host = config.require("host");

const tunnel = new Tunnel("splates", {
	host,
	email: config.require("email"),
	accountId: config.require("accountId"),
	zoneId: config.require("zoneId"),
});
new DeployKeys("keys", { projects: config.requireObject("projects") });
const box = new CoordinatorBox("splates", {
	host,
	secrets: {
		SPLATES_TUNNEL_TOKEN: tunnel.token,
		SPLATES_CLOUDFLARE_API_TOKEN: new pulumi.Config("cloudflare").requireSecret(
			"apiToken",
		),
		ANTHROPIC_API_KEY: config.requireSecret("anthropicKey"),
	},
});

export const instanceId = box.instanceId;
export const ipv4 = box.ipv4;
export const roleName = box.roleName;
export const sshKey = box.sshKey;
export const tunnelHost = box.host;
export const tunnelRecord = {
	team: tunnel.team,
	aud: tunnel.aud,
	id: tunnel.tunnelId,
};
