#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-3333}"
HOST="${HOST:-127.0.0.1}"

echo "🧠 Starting Second Brain on ${HOST}:${PORT}..."
npm run dev -- -p "${PORT}" -H "${HOST}"
