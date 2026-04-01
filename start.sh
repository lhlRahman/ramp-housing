#!/bin/bash
set -e

echo "Starting Ramp Housing..."

# Backend
cd "$(dirname "$0")/backend"
if [ -d "venv" ]; then
  source venv/bin/activate
fi
uvicorn main:app --reload --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}" &
BACKEND_PID=$!

# Frontend
cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:${PORT:-8000}"
echo "  Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
