#!/bin/bash
PROJECT_NAME=$(basename "$PWD")
PRIMER="$HOME/.claude/primer.md"
MEMORY=".claude-memory.md"
LESSONS="tasks/lessons.md"

# Read primer.md
PRIMER_CONTENT=""
if [ -f "$PRIMER" ]; then
  PRIMER_CONTENT=$(cat "$PRIMER")
fi

# Get last 5 git commits
GIT_LOG=""
if git rev-parse --git-dir > /dev/null 2>&1; then
  GIT_LOG=$(git log --oneline -5 2>/dev/null || echo "No commits yet")
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  MODIFIED=$(git status --short 2>/dev/null || echo "")
else
  GIT_LOG="Not a git repository"
  BRANCH="N/A"
  MODIFIED=""
fi

# Last 30 lines of .claude-memory.md
MEMORY_CONTENT=""
if [ -f "$MEMORY" ]; then
  MEMORY_CONTENT=$(tail -30 "$MEMORY")
fi

# Read tasks/lessons.md
LESSONS_CONTENT=""
if [ -f "$LESSONS" ]; then
  LESSONS_CONTENT=$(cat "$LESSONS")
fi

# Build system prompt
CONTEXT="PROJECT: $PROJECT_NAME
BRANCH: $BRANCH

=== PRIMER ===
$PRIMER_CONTENT

=== LAST 5 COMMITS ===
$GIT_LOG

=== MODIFIED FILES ===
$MODIFIED

=== RECENT MEMORY (last 30 lines) ===
$MEMORY_CONTENT

=== LESSONS LEARNED ===
$LESSONS_CONTENT"

if [ -n "$1" ]; then
  # Automated: prompt passed as argument, run and exit
  claude --dangerously-skip-permissions \
    --system-prompt "$CONTEXT" \
    -p "$1"
else
  # Interactive: no argument, open session with context loaded
  claude --dangerously-skip-permissions \
    --system-prompt "$CONTEXT"
fi