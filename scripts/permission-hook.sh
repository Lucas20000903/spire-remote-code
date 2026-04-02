#!/usr/bin/env bash
# Spire PermissionRequest hook
# 1. 서버에 알림 (비블로킹)
# 2. 즉시 "ask" 반환 → 터미널 프롬프트 즉시 표시
# 3. 폰에서 응답하면 서버가 tmux send-keys로 터미널에 주입
# → 결과: PC와 폰 둘 다 응답 가능, 먼저 온 쪽이 처리

SPIRE_SERVER="${SPIRE_SERVER:-http://localhost:3000}"

command -v jq &>/dev/null || exit 0
command -v curl &>/dev/null || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOOL_USE_ID=$(echo "$INPUT" | jq -r '.tool_use_id // empty')

[ -z "$TOOL_NAME" ] && exit 0

# tmux 세션명 감지
TMUX_SESSION=""
if [ -n "$TMUX" ]; then
  TMUX_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
fi

# 서버에 알림 (백그라운드, 비블로킹)
curl -s --max-time 2 -X POST "$SPIRE_SERVER/api/hooks/permission" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg tn "$TOOL_NAME" \
    --argjson ti "$TOOL_INPUT" \
    --arg sid "$SESSION_ID" \
    --arg tmux "$TMUX_SESSION" \
    --arg tuid "$TOOL_USE_ID" \
    '{tool_name: $tn, tool_input: $ti, session_id: $sid, tmux_session: $tmux, tool_use_id: $tuid}')" \
  &>/dev/null &

# 즉시 "ask" 반환 → 터미널에서 정상 권한 프롬프트 표시
jq -n '{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "ask"
    }
  }
}'
