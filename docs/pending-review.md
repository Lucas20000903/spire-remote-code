# 확인 필요 항목

## 버그 수정 (B1-B7)
- [ ] B1: 어시스턴트 응답 줄바꿈 보존 (remark-breaks 추가)
- [ ] B2: 같은 cwd 세션 중복 표시 (bridge_id로만 필터)
- [ ] B3: 새 세션이 기존 세션 덮어쓰기 (B2와 동일 수정)
- [ ] B4: /clear 후 jsonl 응답 미표시 (session_id 매칭 확장)
- [ ] B5: B4 연쇄 — 세션 소멸 (B4 수정으로 대응)
- [ ] B6: 유저 메시지 가로 스크롤 (overflow-hidden + break-words)
- [ ] B7: 유저/어시스턴트 폰트 크기 통일 (text-sm 추가)

## UI 변경
- [ ] 입력창 패딩 트랜지션 (p-4, 비활성시 px-6)
- [ ] 입력창 backdrop blur
- [ ] 스크롤바 숨김 (MessageList)
- [ ] 입력창 높이만큼 채팅 영역 paddingBottom
- [ ] 입력창 크기 변화 시 자동 스크롤 보정
- [ ] 채팅 전송 시 맨 아래 스크롤

## 미구현 (다음 단계)
- [ ] F1: Task 리스트 아코디언 UI (jsonl의 TaskCreate/TaskUpdate 파싱)
