# Splates infrastructure, as Pulumi components

`splates server infra init <dir> --host splates.example.com --email me@example.com --projects app=me/app`
writes a Pulumi project that imports these components; edit it from there:

- `CoordinatorBox`: the AWS side. A one-subnet VPC without a NAT gateway, an
  SSH-only security group, a `t3.medium` with IMDSv2 and termination
  protection, the instance role (SSM parameters under `/splates/*`, workers),
  daily snapshots (7 kept) and the creds' `SecureString` parameters.
- `Tunnel`: what `splates tunnel setup` makes, as Cloudflare resources. Its token
  goes to the box's parameter, never onto a laptop.
- `DeployKeys`: a write deploy key per project on GitHub, its private half in
  `/splates/projects/<slug>/SPLATES_DEPLOY_KEY`.

The program exports `instanceId`, `ipv4`, `roleName`, `tunnelHost`, `tunnelRecord` (the Access
team, AUD tag and tunnel id) and `sshKey` (a secret: the private half of the key
pair that logs in as root), which `splates server deploy` takes: it writes the
box's `tunnel.json` from `tunnelRecord`. The Cloudflare API token that mints
worker service tokens goes to the box's parameters from the stack's
`cloudflare:apiToken`. `splates server infra init` records the directory in
`~/.splates/coordinator/infra.json`, which is how the deploy finds the stack.

The Pulumi packages are optional peer dependencies of
`@stringsync/splates-server`: the project `infra init` writes installs
`@pulumi/pulumi`, `aws`, `awsx`, `cloudflare`, `github`, `tls` and `random`. The
program uses `awsx` and these components; `@pulumi/cdk` is an option for those
who prefer CDK constructs, but it is newer and TypeScript-only.

## Short-lived AWS credentials with Pulumi ESC

An environment (`pulumi env init <org>/splates-aws`) that logs `pulumi up` in
over OIDC, then `imports: [<org>/splates-aws]` under the stack's
`environment:`:

```yaml
values:
  aws:
    login:
      fn::open::aws-login:
        oidc:
          duration: 1h
          roleArn: arn:aws:iam::<account>:role/pulumi-deploy
          sessionName: pulumi-esc
  environmentVariables:
    AWS_ACCESS_KEY_ID: ${aws.login.accessKeyId}
    AWS_SECRET_ACCESS_KEY: ${aws.login.secretAccessKey}
    AWS_SESSION_TOKEN: ${aws.login.sessionToken}
```

## State outside Pulumi Cloud

`pulumi login s3://<bucket>?region=<region>` keeps state in S3, and
`pulumi stack init prod --secrets-provider "awskms://alias/pulumi?region=<region>"`
encrypts the secrets, the parameters' values among them, with your KMS key.
