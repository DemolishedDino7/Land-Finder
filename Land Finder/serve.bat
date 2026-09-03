@echo off
echo Serving on http://localhost:8000  (Ctrl+C to stop)
start "" http://localhost:8000
python -m http.server 8000
