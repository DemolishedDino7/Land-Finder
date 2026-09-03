#!/usr/bin/env bash
echo "Serving on http://localhost:8000  (Ctrl+C to stop)"
(command -v xdg-open >/dev/null && xdg-open http://localhost:8000) || \
(command -v open >/dev/null && open http://localhost:8000) || true
python3 -m http.server 8000
