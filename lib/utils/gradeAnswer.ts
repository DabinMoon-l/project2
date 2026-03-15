/**
 * 정답 확인 — OX/객관식/단답형 통합 채점 유틸리티
 *
 * 두 곳에서 중복되던 채점 로직을 단일 소스로 통합:
 *   - components/review/reviewPracticeUtils.ts  (checkSingleAnswer)
 *   - components/quiz/manage/quizStatsUtils.ts  (checkCorrect)
 *
 * 이 함수는 순수 함수이며, 특정 도메인 타입에 의존하지 않는다.
 *
 * @param questionType - 문제 유형 ('ox' | 'multiple' | 'short_answer' | 'short' 등)
 * @param correctAnswer - 정답
 *   - OX: 'O', 'X', '0'(=O), '1'(=X)
 *   - 객관식 단일: 0-indexed 숫자 또는 문자열 (예: 2, '2')
 *   - 객관식 복수: 쉼표 구분 문자열 또는 숫자 배열 (예: '0,2', [0, 2])
 *   - 단답형: 문자열, 복수정답은 '|||' 구분 (예: 'apple|||apples')
 * @param userAnswer - 사용자 답안
 *   - OX: 'O', 'X', '0', '1', 숫자 0/1
 *   - 객관식 단일: 0-indexed 숫자 (예: 2)
 *   - 객관식 복수: 숫자 배열 또는 쉼표 구분 문자열 (예: [0, 2], '2,0')
 *   - 단답형: 문자열
 * @returns 정답 여부
 */
export function gradeAnswer(
  questionType: string,
  correctAnswer: string | number | number[] | null | undefined,
  userAnswer: string | number | number[] | null | undefined,
): boolean {
  // null/undefined 답안 → 오답
  if (userAnswer === null || userAnswer === undefined) return false;

  // 정답이 없는 경우 → 오답 (단, '0'은 유효한 정답이므로 falsy 체크 불가)
  if (correctAnswer === null || correctAnswer === undefined) return false;

  // 문자열로 정규화
  const correctStr = Array.isArray(correctAnswer)
    ? correctAnswer.join(',')
    : correctAnswer.toString();
  const userStr = Array.isArray(userAnswer)
    ? userAnswer.join(',')
    : userAnswer.toString();

  // ─── OX 문제 ───
  // '0' / 0 / 'O' / 'o' → 모두 O로 정규화, '1' / 1 / 'X' / 'x' → X
  if (questionType === 'ox') {
    const normalizeOX = (val: string): 'O' | 'X' => {
      const upper = val.toUpperCase();
      if (upper === 'O' || upper === '0') return 'O';
      return 'X'; // 'X', '1', 기타
    };
    return normalizeOX(correctStr) === normalizeOX(userStr);
  }

  // ─── 객관식 ───
  // 단일/복수 모두 0-indexed 숫자로 파싱 후 정렬 비교
  if (questionType === 'multiple') {
    const parseIndices = (val: string | number[]): number[] => {
      if (Array.isArray(val)) return val;
      return val
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n));
    };

    const correctIndices = parseIndices(
      Array.isArray(correctAnswer) ? correctAnswer : correctStr,
    );
    const userIndices = parseIndices(
      Array.isArray(userAnswer) ? userAnswer : userStr,
    );

    if (correctIndices.length !== userIndices.length) return false;

    const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
    const sortedUser = [...userIndices].sort((a, b) => a - b);
    return sortedCorrect.every((val, idx) => val === sortedUser[idx]);
  }

  // ─── 단답형/주관식 (short_answer, short, 기타) ───
  // 대소문자 무시, trim, 복수정답('|||')은 하나라도 일치하면 정답
  const userNormalized = userStr.trim().toLowerCase();
  if (correctStr.includes('|||')) {
    const acceptedAnswers = correctStr.split('|||').map(a => a.trim().toLowerCase());
    return acceptedAnswers.some(a => userNormalized === a);
  }
  return userNormalized === correctStr.trim().toLowerCase();
}
