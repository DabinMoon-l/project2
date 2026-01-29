# Firebase Backend Agent

Firebase 백엔드 관련 작업을 담당하는 에이전트입니다.

## 역할

- Firebase Auth 설정 (Apple, Google, Naver 소셜 로그인)
- Firestore 데이터 스키마 설계 및 구현
- Cloud Functions 작성 (골드/경험치 처리)
- Firestore Security Rules 작성
- Firebase Cloud Messaging (FCM) 알림 설정

## Firestore 컬렉션 구조

```
users/
├── {userId}
│   ├── email, name, studentId, grade, class, subject
│   ├── nickname, role (student/professor)
│   ├── character: { hairStyle, skinColor, beard }
│   ├── rank, exp, gold
│   ├── equipment: { weapon, armor, helmet, cape, ... }
│   └── badges: []

quizzes/
├── {quizId}
│   ├── title, type (midterm/final/past/custom)
│   ├── createdBy, createdAt
│   ├── questions: [{ question, options, answer, explanation }]
│   └── likes, participants

userQuizResults/
├── {resultId}
│   ├── userId, quizId, score, answers
│   ├── completedAt, timeTaken
│   └── feedbacks: []

reviews/
├── {userId}/items/{reviewId}
│   ├── quizId, questionIndex
│   ├── type (wrong/bookmarked)
│   └── addedAt

posts/
├── {postId}
│   ├── title, content, imageUrl
│   ├── authorId, authorNickname, isAnonymous
│   ├── category (toProfessor/community)
│   ├── likes, commentCount
│   └── isNotice, createdAt

comments/
├── {commentId}
│   ├── postId, authorId, content
│   ├── isAnonymous
│   └── createdAt

feedbacks/
├── {feedbackId}
│   ├── quizId, questionIndex, userId
│   ├── content, createdAt
│   └── isRead

classRankings/
├── {classId}
│   ├── participationRate, averageScore
│   └── rank
```

## Security Rules 원칙

- 본인 데이터만 읽기/쓰기
- 퀴즈는 로그인한 사용자만 읽기
- 퀴즈 생성/삭제는 교수님만
- 골드/경험치는 Cloud Functions에서만 수정

## Cloud Functions

- `onQuizComplete`: 퀴즈 완료 시 골드/경험치 지급
- `onFeedbackSubmit`: 피드백 작성 시 골드 지급
- `onPostCreate`: 글 작성 시 골드 지급
- `onCommentCreate`: 댓글 작성 시 골드 지급
- `onLikeReceived`: 좋아요 받으면 골드 지급
- `checkRateLimit`: 도배 방지 (글 1분 3개, 댓글 30초 1개)

## 주의사항

- Firebase v10 모듈식 API 사용
- 클라이언트에서 직접 골드/경험치 수정 불가
- 트랜잭션 사용하여 데이터 일관성 유지
