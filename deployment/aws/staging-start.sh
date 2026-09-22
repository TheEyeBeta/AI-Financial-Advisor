#!/usr/bin/env bash
# Starts the staging EC2 instance on demand and prints its (ephemeral)
# public IP. Staging has no Elastic IP on purpose — an unattached EIP is
# billed hourly, which would defeat the point of only paying while staging
# is actually in use. The IP changes on every start, so update whatever
# you're pointing at staging (curl, Postman, a temporary Vercel preview
# env var) each time you run this.
set -euo pipefail

INSTANCE_ID="i-09cb8ab036f055e7e"

aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
echo "Starting $INSTANCE_ID ..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"

IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)

echo "Staging is up: $IP"
echo "SSH:  ssh -i ~/.ssh/afa-aws-backend.pem ubuntu@$IP"
echo "API (once the compose stack is running): http://$IP:8002"
echo "Remember to run staging-stop.sh when you're done testing."
