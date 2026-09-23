---
name: aws-cli-ops
description: >-
  Operates this repository's live AWS backend infrastructure through the AWS CLI:
  EC2 production/staging lifecycle, SSM access, CloudWatch alarms, SNS alerts,
  Budgets/Cost Explorer, and the staging auto-stop Scheduler. Use only for the
  verified account 005185643725 in us-east-1. Do not use for generic AWS design
  or unapproved infrastructure changes.
---

# Skill: aws-cli-ops

## When to use

- Checking or operating the repository's production/staging EC2 instances.
- Using Systems Manager for preferred remote access and non-interactive checks.
- Inspecting CloudWatch alarms/metrics, SNS subscriptions, AWS Budgets / Cost Explorer, or the staging EventBridge Scheduler.
- Temporarily allowing a single trusted public IP on SSH/22 when raw SSH is explicitly required and a human has approved the security-group change in the current task.

## Do not use for

- Generic AWS architecture, provisioning, Terraform, or service-selection advice.
- Creating or redesigning IAM, security groups, Cloudflare routes, Vercel settings, Supabase settings, or GitHub Environment protection rules.
- Treating a documented command as blanket permission to mutate production infrastructure.

## Risk classification

**High** — this skill touches live production/staging infrastructure and billing controls. Wrong-account, wrong-region, production-stop, security-group, IAM, or alerting mistakes can cause outage, exposure, or cost.

## Repository authority and known resources

Read deployment/aws/README.md first. It is authoritative for resources it explicitly documents, subject to root AGENTS.md, which wins on conflict.

Repository-verified values:

| Resource | Verified repo value |
|---|---|
| AWS account | 005185643725 |
| Region | us-east-1 |
| Prod EC2 | i-091397a3f0e899b3d — t4g.micro, intended 24/7 |
| Staging EC2 | i-09cb8ab036f055e7e — t4g.micro, stopped by default |
| Security group | sg-0c81a063d376b31d0 |
| Prod Elastic IP | 54.152.217.162 |
| Cloudflare Tunnel | afa-prod-backend, id 19b2d994-4d4f-4951-bc9a-93733f1a0ef7 |

The following names are **expected from current operational context but are not proven by the current README**. Verify them with read-only CLI calls before treating them as facts:

- CloudWatch alarms: afa-prod-cpu-high, afa-prod-disk-high, afa-prod-mem-high, afa-prod-status-check-failed, afa-staging-status-check-failed
- SNS topic: afa-alerts
- Budget: afa-monthly-budget (expected USD 10/month, 80% ACTUAL and 100% FORECASTED notifications)
- Scheduler: afa-staging-auto-stop-safety-net
- EC2 instance profile / role: expected afa-cloudwatch-agent-role/profile with SSM access

If live read-only AWS output contradicts repository documentation, **stop mutating operations, record the discrepancy, and report documentation drift**. Never invent an ARN, role, policy, alarm, schedule, or CLI flag.

## Required reading

Before operating AWS:

- Root AGENTS.md — production-infra forbidden zones and approval requirements.
- deployment/AGENTS.md.
- deployment/aws/README.md.
- .github/workflows/deploy-prod.yml.
- .github/workflows/deploy-staging.yml.
- skills/instruction-stack-steward/SKILL.md when changing this skill or other governance files.

Do not duplicate the instruction-stack-steward process here; follow it.

## Mandatory account/region preflight

Every AWS workflow starts with identity and region verification.

### Git Bash

~~~bash
PY="/c/Users/UGO/AppData/Local/Programs/Python/Python310/python.exe"

"$PY" -m awscli --version
"$PY" -m awscli sts get-caller-identity
"$PY" -m awscli configure get region
~~~

### PowerShell

~~~powershell
$py = "C:\Users\UGO\AppData\Local\Programs\Python\Python310\python.exe"

& $py -m awscli --version
& $py -m awscli sts get-caller-identity
& $py -m awscli configure get region
~~~

**Hard gate:** do not run mutating AWS commands unless sts get-caller-identity returns account 005185643725 and the intended regional operation is explicitly using us-east-1.

Prefer passing --region us-east-1 on regional operational commands even when the configured default is correct.

If credentials are missing/expired, the account differs, or the region is ambiguous: **STOP**.

## Local AWS CLI environment

On this Windows machine, plain python may resolve to Python 3.14 rather than the interpreter carrying the installed awscli. The known interpreter is:

~~~text
C:\Users\UGO\AppData\Local\Programs\Python\Python310\python.exe
~~~

Use python -m awscli only after proving that python resolves to the intended environment. Otherwise use the explicit interpreter shown above.

The current pip-installed client is expected to be AWS CLI v1; verify with --version. Do not use CLI-v2-only options unless the installed version supports them. AWS CLI v2 is the preferred long-term client, but upgrading/installing it is outside this skill unless explicitly requested.

## Shell conventions

- Git Bash line continuation: backslash.
- PowerShell line continuation: backtick.
- AWS documentation examples generally use Unix quoting; adapt them for PowerShell.
- For JSON-heavy parameters in PowerShell, prefer single-quoted literal JSON or generate JSON with ConvertTo-Json; do not paste Bash escaping blindly.

## Workflow

1. Run the account/region preflight.
2. Read current repo deployment docs and the relevant workflow before acting.
3. Inspect live state with read-only commands.
4. Classify the intended action as read-only, routine staging lifecycle, or sensitive mutation.
5. Require current-task human approval for sensitive mutations governed by root AGENTS.md.
6. Execute the narrowest command possible.
7. Verify post-state explicitly.
8. Report commands run, outcomes, unresolved drift, and whether any temporary access rule was removed.

## EC2 status and lifecycle

### Inspect both instances

Git Bash:

~~~bash
"$PY" -m awscli ec2 describe-instances \
  --region us-east-1 \
  --instance-ids i-091397a3f0e899b3d i-09cb8ab036f055e7e \
  --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,PublicIp:PublicIpAddress,Profile:IamInstanceProfile.Arn,Monitoring:Monitoring.State}' \
  --output table
~~~

PowerShell:

~~~powershell
& $py -m awscli ec2 describe-instances `
  --region us-east-1 `
  --instance-ids i-091397a3f0e899b3d i-09cb8ab036f055e7e `
  --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,PublicIp:PublicIpAddress,Profile:IamInstanceProfile.Arn,Monitoring:Monitoring.State}' `
  --output table
~~~

describe-instance-status normally reports running instances only. To include stopped staging:

~~~bash
"$PY" -m awscli ec2 describe-instance-status \
  --region us-east-1 \
  --include-all-instances \
  --instance-ids i-091397a3f0e899b3d i-09cb8ab036f055e7e
~~~

### Start staging

Staging is stopped by default. Starting it is a live mutation; do it only when the task actually requires staging.

Git Bash:

~~~bash
"$PY" -m awscli ec2 start-instances --region us-east-1 --instance-ids i-09cb8ab036f055e7e
"$PY" -m awscli ec2 wait instance-running --region us-east-1 --instance-ids i-09cb8ab036f055e7e
"$PY" -m awscli ec2 describe-instances --region us-east-1 --instance-ids i-09cb8ab036f055e7e \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
~~~

PowerShell:

~~~powershell
& $py -m awscli ec2 start-instances --region us-east-1 --instance-ids i-09cb8ab036f055e7e
& $py -m awscli ec2 wait instance-running --region us-east-1 --instance-ids i-09cb8ab036f055e7e
& $py -m awscli ec2 describe-instances --region us-east-1 --instance-ids i-09cb8ab036f055e7e `
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
~~~

### Stop staging after use

Git Bash:

~~~bash
"$PY" -m awscli ec2 stop-instances --region us-east-1 --instance-ids i-09cb8ab036f055e7e
"$PY" -m awscli ec2 wait instance-stopped --region us-east-1 --instance-ids i-09cb8ab036f055e7e
~~~

PowerShell:

~~~powershell
& $py -m awscli ec2 stop-instances --region us-east-1 --instance-ids i-09cb8ab036f055e7e
& $py -m awscli ec2 wait instance-stopped --region us-east-1 --instance-ids i-09cb8ab036f055e7e
~~~

**Production stop guard:** never stop i-091397a3f0e899b3d as a diagnostic or documentation test. A production stop requires explicit human authorization in the current task.

## SSM — preferred access

Prefer SSM over raw SSH when possible; SSM avoids changing inbound port 22.

### Verify managed-node registration

~~~bash
"$PY" -m awscli ssm describe-instance-information \
  --region us-east-1 \
  --query 'InstanceInformationList[].{Id:InstanceId,Ping:PingStatus,Platform:PlatformName,Agent:AgentVersion}' \
  --output table
~~~

A stopped EC2 instance will not appear as an online managed node; staging must be running and registered before SSM access works.

### Session Manager: interactive access

Session Manager is interactive and requires the local Session Manager plugin.

~~~bash
session-manager-plugin --version
"$PY" -m awscli ssm start-session --region us-east-1 --target i-091397a3f0e899b3d
~~~

PowerShell:

~~~powershell
session-manager-plugin --version
& $py -m awscli ssm start-session --region us-east-1 --target i-091397a3f0e899b3d
~~~

If the plugin is absent, report that; do not pretend start-session is available.

### Run Command: deterministic non-interactive checks

send-command / get-command-invocation is **Systems Manager Run Command**, not Session Manager.

Git Bash:

~~~bash
CMD_ID=$("$PY" -m awscli ssm send-command \
  --region us-east-1 \
  --instance-ids i-091397a3f0e899b3d \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["hostname","uptime","systemctl is-active docker","systemctl is-active cloudflared","df -h"]' \
  --query 'Command.CommandId' \
  --output text)

"$PY" -m awscli ssm get-command-invocation \
  --region us-east-1 \
  --command-id "$CMD_ID" \
  --instance-id i-091397a3f0e899b3d
~~~

PowerShell:

~~~powershell
$params = '{"commands":["hostname","uptime","systemctl is-active docker","systemctl is-active cloudflared","df -h"]}'

$commandId = & $py -m awscli ssm send-command `
  --region us-east-1 `
  --instance-ids i-091397a3f0e899b3d `
  --document-name AWS-RunShellScript `
  --parameters $params `
  --query 'Command.CommandId' `
  --output text

& $py -m awscli ssm get-command-invocation `
  --region us-east-1 `
  --command-id $commandId `
  --instance-id i-091397a3f0e899b3d
~~~

Inspect Status, ResponseCode, StandardOutputContent, and StandardErrorContent. Do not use Run Command to bypass repo governance or execute destructive shell commands without explicit authorization.

## SSH security-group /32 procedure

Security group: sg-0c81a063d376b31d0.

The GitHub deploy workflows temporarily authorize the GitHub-hosted runner IP and revoke it afterward. A human operating locally must handle a local temporary rule manually when raw SSH is explicitly required.

Root AGENTS.md requires explicit human go-ahead in the current task before a security-group mutation.

Inspect first:

~~~bash
"$PY" -m awscli ec2 describe-security-group-rules \
  --region us-east-1 \
  --filters Name=group-id,Values=sg-0c81a063d376b31d0
~~~

After approval, authorize only the current caller IPv4 /32.

Git Bash:

~~~bash
MY_IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '\r\n')"

"$PY" -m awscli ec2 authorize-security-group-ingress \
  --region us-east-1 \
  --group-id sg-0c81a063d376b31d0 \
  --protocol tcp --port 22 --cidr "$MY_IP/32"
~~~

PowerShell:

~~~powershell
$myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()

& $py -m awscli ec2 authorize-security-group-ingress `
  --region us-east-1 `
  --group-id sg-0c81a063d376b31d0 `
  --protocol tcp --port 22 --cidr "$myIp/32"
~~~

Revoke the same exact rule immediately after the SSH task.

Git Bash:

~~~bash
"$PY" -m awscli ec2 revoke-security-group-ingress \
  --region us-east-1 \
  --group-id sg-0c81a063d376b31d0 \
  --protocol tcp --port 22 --cidr "$MY_IP/32"
~~~

PowerShell:

~~~powershell
& $py -m awscli ec2 revoke-security-group-ingress `
  --region us-east-1 `
  --group-id sg-0c81a063d376b31d0 `
  --protocol tcp --port 22 --cidr "$myIp/32"
~~~

Never authorize 0.0.0.0/0 or ::/0 for SSH. Verify the rule is gone with describe-security-group-rules.

## CloudWatch

Expected alarms must be verified live before use:

- afa-prod-cpu-high
- afa-prod-disk-high
- afa-prod-mem-high
- afa-prod-status-check-failed
- afa-staging-status-check-failed

Inspect:

~~~bash
"$PY" -m awscli cloudwatch describe-alarms \
  --region us-east-1 \
  --alarm-names afa-prod-cpu-high afa-prod-disk-high afa-prod-mem-high afa-prod-status-check-failed afa-staging-status-check-failed \
  --output table
~~~

History:

~~~bash
"$PY" -m awscli cloudwatch describe-alarm-history \
  --region us-east-1 \
  --alarm-name afa-prod-cpu-high \
  --history-item-type StateUpdate
~~~

Do not create alarms, dashboards, custom metrics, or enable detailed monitoring merely because the account is currently within a free allocation.

At authoring time AWS documents a CloudWatch free allocation including 10 standard-resolution alarm metrics, 10 custom/detailed-monitoring metrics, 5 GB Logs usage, and 3 custom dashboards referencing up to 50 metrics each. Treat pricing as time-sensitive: verify current AWS pricing and current account usage before adding observability resources.

## SNS

Expected topic name: afa-alerts. Discover the live ARN; never invent it.

~~~bash
"$PY" -m awscli sns list-topics --region us-east-1
~~~

After identifying the exact ARN:

~~~bash
"$PY" -m awscli sns get-topic-attributes --region us-east-1 --topic-arn <verified-topic-arn>
"$PY" -m awscli sns list-subscriptions-by-topic --region us-east-1 --topic-arn <verified-topic-arn>
~~~

Adding an email subscription is a mutation and requires explicit authorization:

~~~bash
"$PY" -m awscli sns subscribe \
  --region us-east-1 \
  --topic-arn <verified-topic-arn> \
  --protocol email \
  --notification-endpoint <email-address>
~~~

An email subscription showing PendingConfirmation is **not active** until the recipient clicks the AWS confirmation email. Verify again with list-subscriptions-by-topic. Do not send arbitrary test notifications without explicit approval.

## Budgets and Cost Explorer

Expected budget name: afa-monthly-budget. Verify it rather than assuming the expected USD 10 amount and notification thresholds are correct.

~~~bash
"$PY" -m awscli budgets describe-budget \
  --account-id 005185643725 \
  --budget-name afa-monthly-budget

"$PY" -m awscli budgets describe-notifications-for-budget \
  --account-id 005185643725 \
  --budget-name afa-monthly-budget
~~~

A normal AWS Budget is an alerting/control-plane budget, **not a guaranteed hard spending cap**, unless a separate verified enforcement action exists.

### Current-month Cost Explorer

Cost Explorer end dates are exclusive.

Git Bash:

~~~bash
START="$(date +%Y-%m-01)"
END="$(date -d tomorrow +%Y-%m-%d)"

"$PY" -m awscli ce get-cost-and-usage \
  --time-period Start="$START",End="$END" \
  --granularity MONTHLY \
  --metrics UnblendedCost
~~~

PowerShell:

~~~powershell
$start = (Get-Date -Day 1).ToString("yyyy-MM-dd")
$end = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")

& $py -m awscli ce get-cost-and-usage `
  --time-period "Start=$start,End=$end" `
  --granularity MONTHLY `
  --metrics UnblendedCost
~~~

Do not build tight billing polling loops; Cost Explorer API usage can itself be billable and cost data is not real-time.

## EventBridge Scheduler staging safety net

Expected schedule: afa-staging-auto-stop-safety-net.

Inspect it:

~~~bash
"$PY" -m awscli scheduler get-schedule \
  --region us-east-1 \
  --name afa-staging-auto-stop-safety-net
~~~

List related schedules when discovery is needed:

~~~bash
"$PY" -m awscli scheduler list-schedules \
  --region us-east-1 \
  --name-prefix afa-
~~~

Verify and report:

- State
- ScheduleExpression
- ScheduleExpressionTimezone if set
- FlexibleTimeWindow
- Target.Arn
- Target.Input
- Target.RoleArn

Do not invent the scheduler execution-role name.

The intended design is an unconditional safety-net stop of staging roughly every four hours. Stopping an already-stopped EC2 instance is deliberately treated as a harmless/idempotent-enough no-op, avoiding a Lambda layer solely to check state first. Do not disable, delete, or retarget the schedule without explicit human approval.

## IAM / instance-profile inspection

Read-only IAM inspection is permitted only as needed to verify SSM/CloudWatch/Scheduler wiring.

~~~bash
"$PY" -m awscli ec2 describe-iam-instance-profile-associations --region us-east-1
"$PY" -m awscli iam get-instance-profile --instance-profile-name <verified-profile-name>
"$PY" -m awscli iam get-role --role-name <verified-role-name>
"$PY" -m awscli iam list-attached-role-policies --role-name <verified-role-name>
"$PY" -m awscli iam list-role-policies --role-name <verified-role-name>
~~~

Do not run IAM mutations such as attach-role-policy, detach-role-policy, create-policy, create-role, create-access-key, delete-access-key, or update-assume-role-policy unless a future human task explicitly authorizes that exact change.

## Forbidden actions

Without explicit human go-ahead in the **current task**, do not:

- widen or otherwise mutate security groups;
- create/rotate/delete IAM credentials;
- attach/detach IAM policies or change trust policies;
- weaken/remove GitHub Environment required-reviewer protections;
- stop production;
- delete AWS resources;
- disable alarms, budgets, or the staging safety-net schedule;
- create new paid infrastructure;
- change Cloudflare routing.

Never interpret this skill's existence as authorization.

## Stop conditions

Stop mutating operations and report when:

- account != 005185643725;
- regional operation is not explicitly in us-east-1;
- an expected resource cannot be found;
- live AWS materially disagrees with repo docs;
- SSM role/profile assumptions do not verify;
- an SNS ARN or Scheduler target/RoleArn cannot be verified;
- the operation requires IAM mutation or SG widening without current approval;
- production would need to be stopped without explicit approval;
- credentials are missing/expired;
- CLI v1/v2 syntax differs from the example.

Do not create a missing resource merely to make the runbook true.

## Safe validation standard

For skill maintenance, execute read-only commands where credentials permit. Mutating examples must not be performed solely to prove syntax.

Classify evidence as one of:

1. **executed** — command actually ran against the intended account;
2. **dry-run validated** — AWS accepted the request shape using a supported --dry-run;
3. **syntax/documentation validated only** — checked against the installed CLI version and official AWS command reference.

Never claim a command was tested when it was not.

## Done when

- Account and region gates passed.
- The live resource targeted by the task was discovered rather than guessed.
- The narrowest required operation completed.
- Post-state was verified.
- Staging was returned to stopped state unless the task explicitly requires it running.
- Any temporary SSH /32 rule was revoked and verified absent.
- No IAM, SG, GitHub Environment, Cloudflare, or production-stop boundary was crossed without explicit approval.
- Any repo-vs-live drift is reported.

## Required evidence in the final response

1. **What was operated** — resource and purpose.
2. **Identity** — account and region verified.
3. **Commands run** — distinguish executed, dry-run, and syntax-only examples.
4. **Before/after state** — especially EC2 lifecycle, SG rules, SSM command status, subscriptions, alarms, budget/scheduler reads.
5. **Drift** — repo documentation vs live AWS differences.
6. **Cost/security notes** — anything that could affect billing or exposure.
7. **Human follow-up** — unresolved approval, confirmation email, missing plugin, or documentation repair.
