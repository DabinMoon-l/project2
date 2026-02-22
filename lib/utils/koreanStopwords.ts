/**
 * 한국어 키워드 추출 유틸리티
 *
 * 게시글 제목/본문에서 의미 있는 키워드를 추출하여
 * 워드클라우드 시각화에 사용합니다.
 */

/** 한국어 불용어 목록 (조사, 접속사, 대명사, 일반 동사 등) */
const STOPWORDS = new Set([
  // 조사
  '은', '는', '이', '가', '을', '를', '에', '의', '로', '도',
  '에서', '으로', '부터', '까지', '와', '과', '랑', '이랑',
  '한테', '에게', '께', '보다', '만', '밖에', '처럼', '같이',
  '마다', '조차', '나마', '든지', '라도', '야', '이야',
  // 접속사
  '그리고', '그래서', '그러나', '하지만', '그런데', '또한', '또',
  '및', '혹은', '또는', '즉', '만약', '그러면', '따라서',
  // 대명사
  '나', '너', '저', '우리', '저희', '그', '이', '그녀',
  '여기', '거기', '저기', '이것', '그것', '저것',
  // 일반 동사/형용사
  '있다', '없다', '하다', '되다', '않다', '못하다', '같다',
  '있는', '없는', '하는', '되는', '않는', '같은',
  '있어', '없어', '해서', '되어', '않아',
  '했다', '됐다', '였다', '겠다',
  '합니다', '입니다', '습니다', '됩니다',
  // 기타
  '것', '수', '등', '때', '중', '더', '잘', '안', '못',
  '좀', '뭐', '왜', '어떻게', '얼마나',
  '정말', '진짜', '너무', '아주', '매우', '많이',
  '이번', '다음', '지금', '오늘', '어제', '내일',
  '그냥', '다시', '아직', '이미', '벌써',
  '근데', '걍', 'ㅋㅋ', 'ㅋㅋㅋ', 'ㅎㅎ', 'ㅎㅎㅎ',
  'ㅠㅠ', 'ㅜㅜ', 'ㅠ', 'ㅜ',
]);

/** 단어 끝에서 제거할 조사 패턴 (긴 것부터 매칭) */
const JOSA_PATTERNS = [
  '에서는', '으로는', '에서도', '으로도',
  '에서', '으로', '부터', '까지',
  '이랑', '한테', '에게',
  '처럼', '같이', '마다', '조차', '나마',
  '든지', '라도', '에는',
  '은', '는', '이', '가', '을', '를',
  '에', '의', '로', '도', '와', '과',
  '랑', '만', '야',
];

/**
 * 단어 끝의 조사를 제거합니다.
 */
function stripJosa(word: string): string {
  for (const josa of JOSA_PATTERNS) {
    if (word.length > josa.length && word.endsWith(josa)) {
      return word.slice(0, -josa.length);
    }
  }
  return word;
}

/**
 * 텍스트를 토큰으로 분리합니다.
 * 공백과 구두점으로 분리하고 정규화합니다.
 */
function tokenize(text: string): string[] {
  return text
    .replace(/[.,!?;:""''「」『』\[\](){}~…·\-_=+<>/\\|@#$%^&*`]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/**
 * 게시글 목록에서 키워드를 추출합니다.
 *
 * @param texts - 분석할 텍스트 배열 (제목 + 본문)
 * @param maxWords - 최대 키워드 수 (기본 50)
 * @param minFreq - 최소 빈도 (기본 2)
 * @returns {text, value}[] — 워드클라우드에 바로 사용 가능한 형태
 */
export function extractKeywords(
  texts: string[],
  maxWords = 50,
  minFreq = 2,
): { text: string; value: number }[] {
  const freq = new Map<string, number>();

  for (const text of texts) {
    const tokens = tokenize(text);

    for (const raw of tokens) {
      const word = stripJosa(raw.toLowerCase());

      // 1글자 이하 제외
      if (word.length <= 1) continue;
      // 숫자만인 토큰 제외
      if (/^\d+$/.test(word)) continue;
      // 불용어 제외
      if (STOPWORDS.has(word)) continue;

      freq.set(word, (freq.get(word) || 0) + 1);
    }
  }

  // 최소 빈도 필터 + 상위 N개 추출
  return Array.from(freq.entries())
    .filter(([, count]) => count >= minFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxWords)
    .map(([text, value]) => ({ text, value }));
}
