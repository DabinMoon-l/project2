/**
 * 퀴즈 문제에 고유 ID 부여
 *
 * Firestore에 저장되는 questions 배열의 각 항목에 안정적인 id를 부여.
 * 기존 id가 있으면 유지, 없으면 `q_xxxxxxxx` 형태로 생성.
 * 인덱스 기반 가짜 ID(q0, q1) 대신 고유 ID를 사용하여
 * 문제 순서 변경/삭제 시에도 커스텀 폴더 등에서 안정적으로 매칭 가능.
 */
export function ensureQuestionIds<T extends Record<string, any>>(questions: T[]): T[] {
  return questions.map((q) => {
    if (q.id) return q;
    return { ...q, id: `q_${crypto.randomUUID().slice(0, 8)}` };
  });
}
