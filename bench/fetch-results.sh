#!/usr/bin/env bash
# Usage: fetch-results.sh <job> <execution> <out.jsonl>
# Pulls one Cloud Run job execution's JSON log lines into a JSONL file.
set -euo pipefail
job=$1 execution=$2 out=$3
gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$job\" AND labels.\"run.googleapis.com/execution_name\"=\"$execution\" AND jsonPayload.event:*" \
  --project zentis-cg1-2026 --limit 10000 --format=json \
  | python3 -c 'import json,sys; [print(json.dumps(e["jsonPayload"])) for e in json.load(sys.stdin)]' > "$out"
wc -l "$out"
