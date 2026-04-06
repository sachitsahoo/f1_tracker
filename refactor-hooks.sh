#!/bin/bash

bash memory.sh "Refactor the useSession hook so it fetches from GET /api/sessions?year=<currentYear> instead of calling OpenF1 directly. The response shape is an array of objects with fields: session_key, session_name, session_type, date_start, date_end, circuit_key, meeting_key. Pick the most recent Race or Sprint session by date_start. No hardcoded session keys. Follow existing hook patterns in the codebase." &

bash memory.sh "Refactor the useDrivers hook so it fetches from GET /api/drivers?session_key=<key> instead of calling OpenF1 directly. The response is a JSON array of driver rows from Supabase. No hardcoded driver numbers. Follow existing hook patterns in the codebase." &

bash memory.sh "Refactor the usePositions hook so it fetches from GET /api/positions?session_key=<key> and optionally &driver_number=<n> instead of calling OpenF1 directly. Data is ordered by date ascending. Keep existing polling interval and cleanup. No hardcoded values. Follow existing hook patterns in the codebase." &

bash memory.sh "Refactor the useLocations hook so it fetches from GET /api/locations?session_key=<key> with optional &driver_number=<n> and &lap_number=<n> filters instead of calling OpenF1 directly. Keep existing polling interval and cleanup. No hardcoded values. Follow existing hook patterns in the codebase." &

bash memory.sh "Refactor the intervals data fetching (hook or wherever it lives) so it calls GET /api/intervals?session_key=<key> with optional &driver_number=<n> instead of calling OpenF1 directly. Keep existing polling interval and cleanup. No hardcoded values. Follow existing hook patterns in the codebase." &

bash memory.sh "Refactor the stints data fetching (hook or wherever it lives) so it calls GET /api/stints?session_key=<key> with optional &driver_number=<n> instead of calling OpenF1 directly. Note: lap_start is nullable — ensure the frontend handles null gracefully. No hardcoded values. Follow existing hook patterns in the codebase." &

bash memory.sh "Refactor the race control data fetching (hook or wherever it lives) so it calls GET /api/race-control?session_key=<key> instead of calling OpenF1 directly. Data is ordered by date ascending. No hardcoded values. Follow existing hook patterns in the codebase." &

wait
echo "All frontend hooks refactored."