#!/usr/bin/env bash
# Usage: deploy-run.sh <image-tag> <job-name> <arms> <tasks> <sessions-per-task> <region>...
# Builds and pushes the bench image, then creates and starts one Cloud Run job per region.
set -euo pipefail
tag=$1 job=$2 arms=$3 tasks=$4 sessions=$5; shift 5
P=zentis-cg1-2026
IMG=europe-west1-docker.pkg.dev/$P/atmos/bench:$tag
cd "$(dirname "$0")/.."
docker build -q -f bench/Dockerfile -t "$IMG" . >/dev/null
docker push -q "$IMG" >/dev/null
for region in "$@"; do
  gcloud run jobs deploy "$job" --project $P --region "$region" --image "$IMG" \
    --cpu 2 --memory 4Gi --tasks "$tasks" --parallelism "$tasks" --max-retries 0 --task-timeout 240m \
    "--set-env-vars=^;^ARMS=$arms;SESSIONS=$sessions;MINUTES=10;REGION=$region" --quiet >/dev/null
  echo "$region $(gcloud run jobs execute "$job" --project $P --region "$region" --async --format='value(metadata.name)')"
done
