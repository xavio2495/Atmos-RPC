#!/usr/bin/env bash
# Usage: fetch-results.sh <job> <execution> <out.jsonl>
# Pulls one Cloud Run job execution's JSON log lines into a JSONL file.
set -euo pipefail
job=$1 execution=$2 out=$3
gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$job\" AND labels.\"run.googleapis.com/execution_name\"=\"$execution\" AND jsonPayload.event:*" \
  --project "${GCP_PROJECT:?set GCP_PROJECT to the Google Cloud project}" --freshness=30d --limit 100000 --format=json \
  | python3 -c 'import json,sys; [print(json.dumps(e["jsonPayload"])) for e in json.load(sys.stdin)]' > "$out"
# An execution older than the log window, or a wrong name, returns nothing: say so.
[ -s "$out" ] || { echo "no log lines for $execution" >&2; exit 1; }
wc -l "$out"
