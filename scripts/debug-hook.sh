#!/usr/bin/env bash
# 훅 입력 데이터를 파일에 덤프
INPUT=$(cat)
echo "$INPUT" | jq . >> /tmp/spire-hook-debug.log 2>/dev/null
echo "---" >> /tmp/spire-hook-debug.log
exit 0
