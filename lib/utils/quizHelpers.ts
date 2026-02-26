// 퀴즈 페이지 공유 상수/유틸

// 신문 배경 텍스트 (생물학 관련)
export const NEWSPAPER_BG_TEXT = `The cell membrane, also known as the plasma membrane, is a biological membrane that separates and protects the interior of all cells from the outside environment. The cell membrane consists of a lipid bilayer, including cholesterols that sit between phospholipids to maintain their fluidity at various temperatures. The membrane also contains membrane proteins, including integral proteins that span the membrane serving as membrane transporters, and peripheral proteins that loosely attach to the outer side of the cell membrane, acting as enzymes to facilitate interaction with the cell's environment. Glycolipids embedded in the outer lipid layer serve a similar purpose. The cell membrane controls the movement of substances in and out of cells and organelles, being selectively permeable to ions and organic molecules. In addition, cell membranes are involved in a variety of cellular processes such as cell adhesion, ion conductivity, and cell signaling.`;

// averageScore fallback 계산
export function parseAverageScore(data: any): number {
  let averageScore = data.averageScore || 0;
  if (!averageScore && data.userScores) {
    const scores = Object.values(data.userScores) as number[];
    if (scores.length > 0) {
      averageScore = Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10;
    }
  }
  return averageScore;
}

// createdAt 기반 정렬 유틸 (최신순)
export function sortByLatest(a: { createdAt?: any }, b: { createdAt?: any }): number {
  const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
  const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
  return bTime - aTime;
}

// 문제 유형을 포맷하여 표시 (예: "OX 2 / 객관식 5 / 주관식 2")
export function formatQuestionTypes(
  oxCount: number = 0,
  multipleChoiceCount: number = 0,
  subjectiveCount: number = 0
): string {
  const parts: string[] = [];
  if (oxCount > 0) parts.push(`OX ${oxCount}`);
  if (multipleChoiceCount > 0) parts.push(`객관식 ${multipleChoiceCount}`);
  if (subjectiveCount > 0) parts.push(`주관식 ${subjectiveCount}`);

  if (parts.length === 0) {
    const total = oxCount + multipleChoiceCount + subjectiveCount;
    return total > 0 ? `${total}문제` : '-';
  }

  return parts.join(' / ');
}
