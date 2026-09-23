#!/usr/bin/env bash
# Stops the staging EC2 instance. Compute billing stops immediately;
# only the 20GB gp3 EBS volume keeps costing (a few cents/month) while
# stopped. The docker containers/state on disk are preserved and resume
# on the next staging-start.sh.
set -euo pipefail

INSTANCE_ID="i-09cb8ab036f055e7e"

aws ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null
echo "Stopping $INSTANCE_ID ..."
aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"
echo "Staging stopped."
