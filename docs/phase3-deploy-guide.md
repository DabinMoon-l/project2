# Phase 3 Wave 1-A 배포 가이드

> Wave 1-A 에서 만든 Edge Function 4개(`get-gemini-usage`, `accept-comment`, `delete-post`, `delete-thread`)를 실제 Supabase 프로젝트에 배포하고 운영으로 전환하는 단계별 가이드.
> 작성일: 2026-04-22

---

## 0. 사전 준비 체크리스트

- [ ] Supabase 프로젝트 존재 (rabbitory-pilot). Dashboard 접근 가능
- [ ] Firebase 프로젝트 접근 가능 (`project2-7a317`)
- [ ] Vercel 프로젝트 admin 권한 (환경변수 수정)
- [ ] 터미널: git bash 또는 WSL (PowerShell 도 가능하지만 예시는 bash 기준)

소요 시간: **최초 세팅 30분, 배포 10분, 2일 dual-deploy 관찰 후 flag on**

---

## 1. Supabase CLI 설치 (1회만)

```bash
npm install -g supabase
supabase --version
# 1.x 가 나오면 OK
```

Windows 에서 권한 문제 나면:
```bash
# npm 대신 scoop 사용
scoop install supabase
```

---

## 2. Supabase 로그인 + 프로젝트 연결 (1회만)

```bash
cd C:/Users/user/Desktop/project2

# 1. Supabase 로그인 (브라우저 창이 열림)
supabase login

# 2. project-ref 확인
#    Supabase Dashboard → Project Settings → General → Reference ID 복사
#    형식: xxxxxxxxxxxxxxxxxxxx (20자)
supabase link --project-ref <여기에-project-ref-붙여넣기>
```

성공하면 `supabase/.temp/` 디렉토리가 생성됨. **git 커밋 대상 아님** (`.gitignore` 에 이미 `supabase/.temp` 넣어두는 게 안전).

---

## 3. Firebase 서비스 계정 JSON 발급 (1회만)

1. https://console.firebase.google.com/ → `project2-7a317` 선택
2. 좌측 상단 톱니바퀴 ⚙️ → **프로젝트 설정** → **서비스 계정** 탭
3. **새 비공개 키 생성** 클릭 → JSON 파일 다운로드
4. 파일 이름을 `firebase-sa.json` 으로 바꾸고 프로젝트 루트에 임시로 둠

⚠️ **절대 git 커밋 금지.** 루트 `.gitignore` 에 이미 막혀있는지 확인:
```bash
echo "firebase-sa.json" >> .gitignore
```

---

## 4. Supabase Secrets 등록 (1회만)

```bash
# Firebase 프로젝트 ID
supabase secrets set FIREBASE_PROJECT_ID=project2-7a317

# 기본 org UUID (현재 파일럿 대학)
supabase secrets set DEFAULT_ORG_ID=13430b1a-0213-403c-9dd4-687bea914ec4

# Firebase 서비스 계정 JSON (파일 내용 전체)
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(cat firebase-sa.json)"
```

PowerShell 이면:
```powershell
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(Get-Content firebase-sa.json -Raw)"
```

확인:
```bash
supabase secrets list
# FIREBASE_PROJECT_ID, DEFAULT_ORG_ID, FIREBASE_SERVICE_ACCOUNT_JSON 3개 나오면 OK
# (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 자동 주입이라 목록에 없을 수 있음)
```

**작업 끝나면 로컬의 `firebase-sa.json` 삭제.** 필요하면 나중에 다시 발급.
```bash
rm firebase-sa.json
```

---

## 5. Edge Function 4개 배포

```bash
cd C:/Users/user/Desktop/project2

supabase functions deploy get-gemini-usage
supabase functions deploy accept-comment
supabase functions deploy delete-post
supabase functions deploy delete-thread
```

각 명령에서 몇 초 ~ 수십 초 걸림 (최초 번들링 느림). 에러 나면:

- **`Cannot resolve npm:firebase-admin@12/app`** → Supabase CLI 버전 구식. `supabase --version` 확인 후 업데이트
- **`Deno parse error`** → `supabase/functions/deno.json` 체크, 최신 받았는지 확인
- **권한 오류** → 프로젝트 link 가 안 돼있음. 2단계 다시

배포 후 Dashboard 에서 확인:
- Supabase Dashboard → **Edge Functions** 탭 → 4개 함수 보여야 함

---

## 6. Day 1 — 배포만, flag off 유지 (프론트 영향 0)

이 시점에서:
- `.env.local` 의 `NEXT_PUBLIC_USE_EDGE_*=false` 그대로 두기
- Vercel 환경변수에는 아직 **추가하지 않음**

즉, **프론트는 아직 Firebase CF 를 그대로 쓰는 상태**. Edge 는 배포됐지만 놀고 있음. 완전 안전.

### 6.1 간단 검증 (선택)

Firebase ID 토큰을 브라우저 콘솔에서 얻어 Edge 를 직접 호출:

1. 로그인한 상태로 브라우저 DevTools Console 열기
2. 다음 붙여넣기 (firebase sdk 가 이미 로드된 상태):
   ```js
   firebase.auth().currentUser.getIdToken().then(t => { console.log(t); })
   ```
3. 출력된 긴 문자열이 토큰. 복사해서 다음 명령:
   ```bash
   SUPABASE_URL="https://<project-ref>.supabase.co"
   TOKEN="<위에서-복사한-토큰>"

   curl -i $SUPABASE_URL/functions/v1/get-gemini-usage \
     -H "Authorization: Bearer $TOKEN"
   ```
4. `{"ok":true,"userCount":0,...}` 형태 응답이면 성공

이 검증이 귀찮으면 건너뛰어도 됨.

### 6.2 로그 관찰

- Supabase Dashboard → Edge Functions → 각 함수 → Logs 탭
- 배포가 제대로 됐는지 cold start 메시지 있는지 확인

---

## 7. Day 2 — Flag 활성화

### 7.1 Vercel 환경변수 추가

Vercel Dashboard → 프로젝트 → Settings → Environment Variables 에 추가:

| Key | Value | Environment |
|-----|-------|------------|
| `NEXT_PUBLIC_USE_EDGE_GET_GEMINI_USAGE` | `true` | Production + Preview + Development |
| `NEXT_PUBLIC_USE_EDGE_ACCEPT_COMMENT` | `true` | 동일 |
| `NEXT_PUBLIC_USE_EDGE_DELETE_POST` | `true` | 동일 |
| `NEXT_PUBLIC_USE_EDGE_DELETE_THREAD` | `true` | 동일 |

### 7.2 재배포

Vercel 에서 환경변수 추가하면 "Redeploy" 버튼이 뜸. 클릭해서 재배포.
(또는 git push 로 자동 트리거)

### 7.3 로컬 `.env.local` 동기화

로컬에서 테스트하고 싶으면 `.env.local` 에도 같은 4줄 추가:
```
NEXT_PUBLIC_USE_EDGE_GET_GEMINI_USAGE=true
NEXT_PUBLIC_USE_EDGE_ACCEPT_COMMENT=true
NEXT_PUBLIC_USE_EDGE_DELETE_POST=true
NEXT_PUBLIC_USE_EDGE_DELETE_THREAD=true
```

---

## 8. 활성화 직후 모니터링 (Day 2 ~ Day 4)

확인할 것:
1. **게시글 삭제** UI 동작 (게시판 → 내 글 → 삭제) → 정상 삭제되는지
2. **댓글 채택** 동작 → EXP 30 증가하는지 (도감/프로필에서 확인)
3. **비공개 글 스레드 삭제** → 콩콩이 답변 같이 삭제되는지
4. **AI 퀴즈 생성 페이지** → Gemini 사용량 숫자 정상 표시

Supabase Dashboard → Edge Functions → Logs 에서:
- 실패 요청 있으면 stack trace 확인
- 응답 시간 (latency) 체크 — p95 500ms 넘으면 이슈

---

## 9. 문제 시 즉시 롤백

환경변수만 `false` 로 바꾸고 재배포하면 끝:

Vercel → Settings → Environment Variables 에서 4개 값을 **false 로 수정** → Redeploy

몇 분 안에 프론트가 다시 Firebase CF 로 원복됨. Edge Function 은 배포된 상태로 남아있으니 원인 해결 후 다시 활성화 가능.

---

## 10. 자주 묻는 질문

**Q. 4개 함수를 한 번에 활성화해도 되나?**
A. `get-gemini-usage` 는 100% 읽기 전용이라 안전. `accept-comment`/`delete-post`/`delete-thread` 는 쓰기가 있으므로 위험 선호하면 2~3일 간격으로 나눠 활성화. 하지만 현재 규모(교수 1명·학생 수십명)에서는 한 번에 해도 무방.

**Q. Firebase CF 는 언제 삭제?**
A. **지금은 절대 삭제하지 않음.** Wave 4 정리 단계 또는 Phase 3 완료 후 1주일 관찰 후 삭제. dual-deploy 기간 동안은 롤백 경로.

**Q. Supabase 비용이 올라가나?**
A. Edge Function 호출은 월 500,000 요청까지 무료. 현재 규모에서 월 10,000 이하 예상. 영향 0.

**Q. Firebase Admin JSON 은 어디 저장?**
A. Supabase Secrets 에만. 로컬 파일은 발급 후 즉시 삭제 권장. 필요하면 Firebase Console 에서 **다른 새 키 발급**하는 게 기존 JSON 재사용보다 안전.

---

## 11. 체크리스트 (인쇄용)

### 최초 1회 세팅
- [ ] Supabase CLI 설치 (`npm install -g supabase`)
- [ ] Supabase 로그인 (`supabase login`)
- [ ] 프로젝트 link (`supabase link --project-ref <ref>`)
- [ ] Firebase 서비스 계정 JSON 발급
- [ ] 3개 secret 등록 (`FIREBASE_PROJECT_ID`, `DEFAULT_ORG_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`)
- [ ] 로컬 JSON 파일 삭제

### 배포 (매 Wave 마다)
- [ ] `supabase functions deploy <함수명>` × N
- [ ] Supabase Dashboard → Functions 목록 확인
- [ ] (선택) curl 수동 검증

### Flag 활성화 (Day 2)
- [ ] Vercel 환경변수 추가 (`NEXT_PUBLIC_USE_EDGE_*=true`)
- [ ] Vercel Redeploy
- [ ] 로컬 `.env.local` 동기화
- [ ] UI 동작 확인 (삭제/채택/사용량 등)
- [ ] Supabase Logs 모니터링 (24시간)

### 문제 시 롤백
- [ ] Vercel 환경변수 `false` 로 변경
- [ ] Redeploy
- [ ] 원인 분석 후 Edge Function 수정 → 재배포 → 다시 flag on
