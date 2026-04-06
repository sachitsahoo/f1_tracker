#!/bin/bash

bash memory.sh "Create /api/sessions.ts as a Vercel serverless function. Accept optional ?year= query param (default current year). Query Supabase sessions table, return all matching rows ordered by date_start descending. Fields needed: session_key, session_name, session_type, date_start, date_end, circuit_key, meeting_key. Use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env. Use @supabase/supabase-js. Follow the same handler pattern as /api/token.ts. GET only, 405 for other methods, 503 if env vars missing, 500 on query failure. No hardcoded values." &

bash memory.sh "Create /api/drivers.ts as a Vercel serverless function. Accept required ?session_key= query param, return 400 if missing. Query Supabase drivers table for all drivers matching that session_key. Return as JSON array. Use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env. Use @supabase/supabase-js. Follow the same handler pattern as /api/token.ts. GET only, 405/503/500 error handling. No hardcoded values." &

bash memory.sh "Create /api/positions.ts as a Vercel serverless function. Accept required ?session_key= query param, return 400 if missing. Accept optional ?driver_number= to filter by a single driver. Query Supabase positions table ordered by date ascending. Use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env. Use @supabase/supabase-js. Follow the same handler pattern as /api/token.ts. GET only, 405/503/500 error handling. No hardcoded values." &

bash memory.sh "Create /api/locations.ts as a Vercel serverless function. Accept required ?session_key= query param, return 400 if missing. Accept optional ?driver_number= and ?lap_number= filters. Query Supabase locations table. Use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env. Use @supabase/supabase-js. Follow the same handler pattern as /api/token.ts. GET only, 405/503/500 error handling. No hardcoded values." &

bash memory.sh "Create /api/intervals.ts as a Vercel serverless function. Accept required ?session_key= query param, return 400 if missing. Accept optional ?driver_number= filter. Query Supabase intervals table ordered by date ascending. Use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env. Use @supabase/supabase-js. Follow the same handler pattern as /api/token.ts. GET only, 405/503/500 error handling. No hardcoded values." &

bash memory.sh "Create /api/stints.ts as a Vercel serverless function. Accept required ?session_key= query param, return 400 if missing. Accept optional ?driver_number= filter. Query Supabase stints table. Note: lap_start is nullable — handle that gracefully. Use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env. Use @supabase/supabase-js. Follow the same handler pattern as /api/token.ts. GET only, 405/503/500 error handling. No hardcoded values." &

bash memory.sh "Create /api/race-control.ts as a Vercel serverless function. Accept required ?session_key= query param, return 400 if missing. Query Supabase race_control table ordered by date ascending. Use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env. Use @supabase/supabase-js. Follow the same handler pattern as /api/token.ts. GET only, 405/503/500 error handling. No hardcoded values." &

wait
echo "All agents done."