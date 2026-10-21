# Splates infrastructure, as Pulumi components

`splates server infra init <dir>` writes a Pulumi project that imports these
components; edit it from there. It fills the stack's config from what splates
keeps: `--projects` from the projects registered here (GitHub origins), `--host`
and `--email` from the saved tunnel and its Access application, the Cloudflare
account and zone ids through the API, and each secret from the creds store
(`SPLATES_CLOUDFLARE_API_TOKEN`, `SPLATES_DEPLOY_GITHUB_TOKEN`,
`ANTHROPIC_API_KEY`) through `pulumi config set --secret` on stdin. A cred not
kept is requested on the Creds page. Each flag overrides its default.

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

The setup step `coordinator-access` signs `pulumi up` and splates in to AWS
with no long-lived key. In AWS CloudShell, one line deploys
`pulumi-access.yaml` as the CloudFormation stack `splates-pulumi`: an OIDC
provider for `api.pulumi.com/oidc` (audience `aws:<org>`) and the role
`splates-pulumi`, which only that Pulumi organization's ESC environments may
assume, for an hour, and whose policy covers what this stack makes, the box's
console and Parameter Store, and cloud workers:

```sh
curl -fsSL https://raw.githubusercontent.com/stringsync/splates/main/packages/server/infra/pulumi-access.yaml -o splates-pulumi.yaml && aws cloudformation deploy --stack-name splates-pulumi --template-file splates-pulumi.yaml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides PulumiOrg=<org>
```

An account that already has the OIDC provider passes its ARN as
`ProviderArn=<arn>` too. The step then makes the environment
`<org>/splates/aws` (`pulumi env init <org>/splates/aws -f -`) and has the
stack import it, as `splates server infra init` also writes once it is
there:

```yaml
# Pulumi.<stack>.yaml
environment:
  - splates/aws
```

```yaml
# <org>/splates/aws
values:
  aws:
    login:
      fn::open::aws-login:
        oidc:
          duration: 1h
          roleArn: arn:aws:iam::<account>:role/splates-pulumi
          sessionName: splates
  environmentVariables:
    AWS_ACCESS_KEY_ID: ${aws.login.accessKeyId}
    AWS_SECRET_ACCESS_KEY: ${aws.login.secretAccessKey}
    AWS_SESSION_TOKEN: ${aws.login.sessionToken}
```

`pulumi env run <org>/splates/aws -- aws sts get-caller-identity` checks it.
ESC needs the stack in Pulumi Cloud; with state in S3, `aws configure` a
profile instead.

## State outside Pulumi Cloud

`pulumi login s3://<bucket>?region=<region>` keeps state in S3, and
`pulumi stack init prod --secrets-provider "awskms://alias/pulumi?region=<region>"`
encrypts the secrets, the parameters' values among them, with your KMS key.
