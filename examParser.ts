/**
 * ================================================================================
 * 문제 파싱 라이브러리 v4.0 - TypeScript 버전
 * ================================================================================
 * 
 * 앱의 문제 유형:
 * - ox: O/X 정답
 * - multiple_choice: 객관식 (선지 + 정답 번호)
 * - short_answer: 단답형 (여러 정답 가능)
 * - essay: 서술형 (루브릭 기반)
 * - combined: 결합형 (공통 보기 + 하위 문제들)
 * 
 * 사용법:
 *   import { parseQuestions, validateQuestions, formatForDisplay } from './examParser';
 *   const questions = parseQuestions(ocrText);
 */

// ============================================================================
// 타입 정의
// ============================================================================

export type AppQuestionType = 'ox' | 'multiple_choice' | 'short_answer' | 'essay' | 'combined';

export interface Choice {
  number: number;
  symbol: string;
  text: string;
  isCorrect: boolean;
}

export interface RubricItem {
  criteria: string;
  percentage: number;
  description?: string;
}

export interface AppQuestion {
  type: AppQuestionType;
  question: string;
  passage: string;
  image: string;
  points: number;
  answer: any;
  originalNumber: number;
  footnotes: string[];
  choices?: Choice[];
  rubric?: RubricItem[];
  subQuestions?: AppQuestion[];
}

export interface ValidationIssue {
  number: number;
  type: string;
  issues: string[];
}

// 내부 타입
interface RawQuestion {
  number: number;
  pairRange: [number, number] | null;
  instruction: string;
  passage: string;
  subPassages: Record<string, string>;
  givenText: string;
  choices: { number: number; symbol: string; text: string }[];
  points: number;
  footnotes: string[];
  raw: string;
}

interface CombinedGroup {
  range: [number, number];
  questions: RawQuestion[];
  sharedPassage: string;
  sharedGiven: string;
  sharedSubs: Record<string, string>;
  footnotes: string[];
}

// ============================================================================
// 상수
// ============================================================================

const CIRCLED_NUMBERS: Record<string, number> = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5,
  '⓵': 1, '⓶': 2, '⓷': 3, '⓸': 4, '⓹': 5,
  '➀': 1, '➁': 2, '➂': 3, '➃': 4, '➄': 5,
};

const NUMBER_TO_SYMBOL: Record<number, string> = {
  1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤',
};

const TYPE_NAMES: Record<AppQuestionType, string> = {
  'ox': 'OX',
  'multiple_choice': '객관식',
  'short_answer': '단답형',
  'essay': '서술형',
  'combined': '결합형',
};

// ============================================================================
// 메인 파서 클래스
// ============================================================================

class ExamParser {
  private rawQuestions: RawQuestion[] = [];

  parse(text: string): AppQuestion[] {
    this.rawQuestions = [];
    
    // 1. 전처리
    text = this.preprocess(text);
    
    // 2. 문제 분리
    const parts = this.splitQuestions(text);
    
    // 3. 개별 파싱
    for (const part of parts) {
      const parsed = this.parseSingle(part);
      if (parsed && parsed.number > 0) {
        this.rawQuestions.push(parsed);
      }
    }
    
    // 4. 앱 형식으로 변환
    return this.convertToAppFormat();
  }

  private preprocess(text: string): string {
    // 제거할 패턴들
    const patternsToRemove = [
      /이\s*문제지에\s*관한\s*저작권[^.]*\./g,
      /(?:^|\n)\s*\d+\s+\d+\s*(?:\n|$)/g,
      /홀수형|짝수형/g,
      /영\s*어\s*영\s*역/g,
      /제\s*\d+\s*교시/g,
      /\d{4}학년도.*?문제지/g,
      /1번부터[\s\S]*?바랍니다\./g,
      /이제\s*듣기[\s\S]*?바랍니다\./g,
      /\*\s*확인\s*사항[\s\S]*/g,
    ];
    
    for (const pattern of patternsToRemove) {
      text = text.replace(pattern, '');
    }
    
    // OCR 오류 수정
    const ocrFixes: Record<string, string> = {
      '丨': '|', '一': '-', '～': '~', '－': '-', '．': '.', '，': ','
    };
    
    for (const [oldChar, newChar] of Object.entries(ocrFixes)) {
      text = text.split(oldChar).join(newChar);
    }
    
    // 공백 정리
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    
    return text.trim();
  }

  private splitQuestions(text: string): string[] {
    // 문제 시작 패턴으로 분리
    const pattern = /(?=(?:^|\n)\s*(?:\d{1,2}\.\s|\[\d{1,2}[~-]\d{1,2}\]))/;
    const parts = text.split(pattern);
    
    return parts
      .map(p => p.trim())
      .filter(p => p && (/^\d{1,2}\./.test(p) || /^\[/.test(p)));
  }

  private parseSingle(text: string): RawQuestion | null {
    if (!text.trim()) return null;
    
    const result: RawQuestion = {
      number: 0,
      pairRange: null,
      instruction: '',
      passage: '',
      subPassages: {},
      givenText: '',
      choices: [],
      points: 2,
      footnotes: [],
      raw: text,
    };
    
    // 번호 추출
    const [num, pairRange] = this.extractNumber(text);
    result.number = num;
    result.pairRange = pairRange;
    
    if (result.number === 0) return null;
    
    // 배점
    result.points = text.includes('[3점]') ? 3 : 2;
    
    // 지시문
    result.instruction = this.extractInstruction(text);
    
    // 주석
    result.footnotes = this.extractFootnotes(text);
    
    // 주어진 글
    result.givenText = this.extractGivenText(text);
    
    // 하위 지문
    result.subPassages = this.extractSubPassages(text);
    
    // 지문
    result.passage = this.extractPassage(text);
    
    // 선택지
    result.choices = this.extractChoices(text);
    
    return result;
  }

  private extractNumber(text: string): [number, [number, number] | null] {
    // [36~37] 형식 (연계 문제)
    const rangeMatch = text.match(/\[(\d{1,2})[~-](\d{1,2})\]/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]);
      const end = parseInt(rangeMatch[2]);
      return [start, [start, end]];
    }
    
    // 18. 형식
    let numMatch = text.match(/^(\d{1,2})\.\s/);
    if (numMatch) {
      return [parseInt(numMatch[1]), null];
    }
    
    // 줄바꿈 후 숫자
    numMatch = text.match(/\n\s*(\d{1,2})\.\s/);
    if (numMatch) {
      return [parseInt(numMatch[1]), null];
    }
    
    return [0, null];
  }

  private extractInstruction(text: string): string {
    const lines = text.split('\n');
    const parts: string[] = [];
    
    for (let line of lines) {
      line = line.trim();
      
      // 문제 번호 제거
      line = line.replace(/^(\d{1,2})\.\s*/, '');
      line = line.replace(/^\[\d{1,2}[~-]\d{1,2}\]\s*/, '');
      
      // 종료 조건
      if (/^[①②③④⑤]/.test(line)) break;
      if (/^\(A\)/.test(line)) break;
      if (line.startsWith('Dear ')) break;
      if (line.startsWith('"') && line.length > 20) break;
      if (/^[A-Z][a-z]/.test(line) && line.length > 50 && !/[가-힣]/.test(line)) break;
      
      // 한글 포함 라인 수집
      if (line && /[가-힣]/.test(line)) {
        parts.push(line);
      }
    }
    
    let result = parts.join(' ');
    result = result.replace(/\[3점\]/g, '');
    result = result.replace(/\s+/g, ' ').trim();
    
    return result;
  }

  private extractFootnotes(text: string): string[] {
    const pattern = /\*\s*([^:\n]+):\s*([^\n*]+)/g;
    const footnotes: string[] = [];
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      footnotes.push(`* ${match[1].trim()}: ${match[2].trim()}`);
    }
    
    return footnotes;
  }

  private extractGivenText(text: string): string {
    const patterns = [
      /순서[\s\S]*?\n\n\s*([\s\S]+?)\n\s*\(A\)/,
      /문장이\s*들어가[\s\S]*?\n\n\s*([\s\S]+?)\n\s*[A-Z]/,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim().replace(/\s+/g, ' ');
      }
    }
    
    return '';
  }

  private extractSubPassages(text: string): Record<string, string> {
    const pattern = /\(([A-D])\)\s*\n?([\s\S]*?)(?=\([A-D]\)|[①②③④⑤]|$)/g;
    const subs: Record<string, string> = {};
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const content = match[2].trim().replace(/\s+/g, ' ');
      if (content && content.length > 10) {
        subs[match[1]] = content;
      }
    }
    
    return subs;
  }

  private extractPassage(text: string): string {
    const lines = text.split('\n');
    const passageLines: string[] = [];
    let started = false;
    
    for (let line of lines) {
      line = line.trim();
      
      // 지문 시작 감지
      if (!started) {
        if (line.startsWith('Dear ')) {
          started = true;
        } else if (line.startsWith('"') && line.length > 15) {
          started = true;
        } else if (/^[A-Z][a-z]/.test(line) && line.length > 40 && !/[가-힣]/.test(line)) {
          started = true;
        }
      }
      
      if (started) {
        // 종료 조건
        if (/^[①②③④⑤]/.test(line)) break;
        if (/^\*\s*\w+:/.test(line)) break;
        passageLines.push(line);
      }
    }
    
    return passageLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private extractChoices(text: string): { number: number; symbol: string; text: string }[] {
    const choices: { number: number; symbol: string; text: string }[] = [];
    const positions: { pos: number; symbol: string; num: number }[] = [];
    
    // 모든 원 숫자 위치 찾기
    for (const [symbol, num] of Object.entries(CIRCLED_NUMBERS)) {
      let pos = 0;
      while ((pos = text.indexOf(symbol, pos)) !== -1) {
        positions.push({ pos, symbol, num });
        pos++;
      }
    }
    
    positions.sort((a, b) => a.pos - b.pos);
    
    // 각 선택지 내용 추출
    for (let i = 0; i < positions.length; i++) {
      const { pos, symbol, num } = positions[i];
      const endPos = i + 1 < positions.length ? positions[i + 1].pos : text.length;
      
      let content = text.substring(pos + symbol.length, endPos).trim();
      
      // 정리
      content = content.replace(/\n\s*/g, ' ');
      content = content.replace(/\s+/g, ' ');
      content = content.replace(/\d{1,2}\.\s.*$/, '');
      content = content.replace(/\[\d{1,2}[~-]\d{1,2}\].*$/, '');
      content = content.trim();
      
      if (content && content.length < 500) {
        choices.push({ number: num, symbol, text: content });
      }
    }
    
    // 중복 제거 (같은 번호면 더 긴 것 선택)
    const seen = new Map<number, { number: number; symbol: string; text: string }>();
    for (const c of choices) {
      const existing = seen.get(c.number);
      if (!existing || c.text.length > existing.text.length) {
        seen.set(c.number, c);
      }
    }
    
    return Array.from(seen.values()).sort((a, b) => a.number - b.number);
  }

  private convertToAppFormat(): AppQuestion[] {
    const combinedRanges = new Map<string, CombinedGroup>();
    const usedNumbers = new Set<number>();
    
    // 1. pair_range가 있는 문제들로 그룹 생성
    for (const q of this.rawQuestions) {
      if (q.pairRange) {
        const key = `${q.pairRange[0]}-${q.pairRange[1]}`;
        
        if (!combinedRanges.has(key)) {
          combinedRanges.set(key, {
            range: q.pairRange,
            questions: [],
            sharedPassage: '',
            sharedGiven: '',
            sharedSubs: {},
            footnotes: [],
          });
        }
        
        // 범위 내 모든 번호 표시
        for (let num = q.pairRange[0]; num <= q.pairRange[1]; num++) {
          usedNumbers.add(num);
        }
      }
    }
    
    // 2. 모든 문제를 적절한 그룹에 배치
    for (const q of this.rawQuestions) {
      let targetKey: string | null = null;
      
      for (const [key, group] of combinedRanges) {
        if (group.range[0] <= q.number && q.number <= group.range[1]) {
          targetKey = key;
          break;
        }
      }
      
      if (targetKey) {
        const group = combinedRanges.get(targetKey)!;
        group.questions.push(q);
        
        // 공유 데이터 수집 (가장 긴 것 선택)
        if (q.passage.length > group.sharedPassage.length) {
          group.sharedPassage = q.passage;
        }
        if (q.givenText.length > group.sharedGiven.length) {
          group.sharedGiven = q.givenText;
        }
        Object.assign(group.sharedSubs, q.subPassages);
        group.footnotes.push(...q.footnotes);
      }
    }
    
    const result: AppQuestion[] = [];
    
    // 3. 일반 문제 변환 (결합형에 포함되지 않은 문제만)
    for (const q of this.rawQuestions) {
      if (!usedNumbers.has(q.number)) {
        result.push(this.toAppQuestion(q, false));
      }
    }
    
    // 4. 결합형 문제 변환
    for (const group of combinedRanges.values()) {
      // 중복 제거
      const seenNums = new Set<number>();
      group.questions = group.questions.filter(q => {
        if (seenNums.has(q.number)) return false;
        seenNums.add(q.number);
        return true;
      });
      
      if (group.questions.length > 0) {
        result.push(this.toCombinedQuestion(group));
      }
    }
    
    // 정렬
    return result.sort((a, b) => a.originalNumber - b.originalNumber);
  }

  private toAppQuestion(q: RawQuestion, isSub: boolean): AppQuestion {
    // 보기 구성
    const passageParts: string[] = [];
    
    if (!isSub) {
      if (q.givenText) passageParts.push(q.givenText);
      if (q.passage) passageParts.push(q.passage);
      
      for (const label of Object.keys(q.subPassages).sort()) {
        passageParts.push(`(${label}) ${q.subPassages[label]}`);
      }
    }
    
    const passage = passageParts.join('\n\n');
    
    // 선택지 변환
    const choices: Choice[] = q.choices.map(c => ({
      number: c.number,
      symbol: c.symbol,
      text: c.text,
      isCorrect: false,
    }));
    
    return {
      type: q.choices.length > 0 ? 'multiple_choice' : 'short_answer',
      question: q.instruction,
      passage,
      image: '',
      points: q.points,
      answer: null,
      originalNumber: q.number,
      footnotes: q.footnotes,
      choices,
    };
  }

  private toCombinedQuestion(group: CombinedGroup): AppQuestion {
    // 공통 보기 구성
    const passageParts: string[] = [];
    
    if (group.sharedGiven) passageParts.push(group.sharedGiven);
    if (group.sharedPassage) passageParts.push(group.sharedPassage);
    
    for (const label of Object.keys(group.sharedSubs).sort()) {
      passageParts.push(`(${label}) ${group.sharedSubs[label]}`);
    }
    
    const combinedPassage = passageParts.join('\n\n');
    
    // 하위 문제 변환
    const subQuestions = group.questions
      .map(q => this.toAppQuestion(q, true))
      .sort((a, b) => a.originalNumber - b.originalNumber);
    
    // 고유한 주석만 유지
    const uniqueFootnotes = [...new Set(group.footnotes)];
    
    // 총 배점 계산
    const totalPoints = subQuestions.reduce((sum, q) => sum + q.points, 0);
    
    return {
      type: 'combined',
      question: `[${group.range[0]}~${group.range[1]}] 다음 글을 읽고 물음에 답하시오.`,
      passage: combinedPassage,
      image: '',
      points: totalPoints,
      answer: null,
      originalNumber: group.range[0],
      footnotes: uniqueFootnotes,
      subQuestions,
    };
  }
}

// ============================================================================
// API 함수
// ============================================================================

/**
 * OCR 텍스트를 파싱하여 앱용 문제 리스트 반환
 * 
 * @param text - OCR로 추출된 텍스트
 * @returns 앱에서 사용할 수 있는 문제 배열
 * 
 * @example
 * const questions = parseQuestions(ocrText);
 * questions.forEach(q => console.log(q.type, q.question));
 */
export function parseQuestions(text: string): AppQuestion[] {
  const parser = new ExamParser();
  return parser.parse(text);
}

/**
 * OCR 텍스트를 파싱하여 JSON 문자열로 반환
 * 
 * @param text - OCR로 추출된 텍스트
 * @param indent - JSON 들여쓰기 (기본값: 2)
 */
export function parseToJSON(text: string, indent: number = 2): string {
  const questions = parseQuestions(text);
  return JSON.stringify(questions, null, indent);
}

/**
 * 파싱된 문제 검증
 * 
 * @param questions - 파싱된 문제 배열
 * @returns 문제가 있는 항목들의 리스트
 */
export function validateQuestions(questions: AppQuestion[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (const q of questions) {
    const qIssues: string[] = [];
    
    // 문제 내용 확인
    if (!q.question && q.type !== 'combined') {
      qIssues.push('문제 내용 누락');
    }
    
    // 객관식 선택지 확인
    if (q.type === 'multiple_choice') {
      const choices = q.choices || [];
      if (choices.length === 0) {
        qIssues.push('선택지 없음');
      } else if (choices.length < 5) {
        qIssues.push(`선택지 부분 누락 (${choices.length}/5)`);
      }
    }
    
    // 결합형 확인
    if (q.type === 'combined') {
      const subs = q.subQuestions || [];
      if (subs.length < 2) {
        qIssues.push(`결합형 하위 문제 부족 (${subs.length}개)`);
      }
      if (!q.passage) {
        qIssues.push('결합형 공통 보기 누락');
      }
    }
    
    if (qIssues.length > 0) {
      issues.push({
        number: q.originalNumber,
        type: q.type,
        issues: qIssues,
      });
    }
  }
  
  return issues;
}

/**
 * 문제를 보기 좋게 포맷팅
 * 
 * @param q - 문제 객체
 * @returns 포맷팅된 문자열
 */
export function formatForDisplay(q: AppQuestion): string {
  const lines: string[] = [];
  
  const typeName = TYPE_NAMES[q.type] || q.type;
  
  lines.push('='.repeat(60));
  lines.push(`문제 ${q.originalNumber} [${typeName}] (${q.points}점)`);
  lines.push('='.repeat(60));
  
  if (q.question) {
    lines.push(`\n📝 문제:\n${q.question}`);
  }
  
  if (q.passage) {
    const passage = q.passage.length > 300 
      ? q.passage.substring(0, 300) + '...' 
      : q.passage;
    lines.push(`\n📖 보기:\n${passage}`);
  }
  
  if (q.type === 'multiple_choice' && q.choices) {
    lines.push('\n🔢 선택지:');
    for (const c of q.choices) {
      lines.push(`  ${c.symbol} ${c.text}`);
    }
  }
  
  if (q.type === 'combined' && q.subQuestions) {
    lines.push(`\n📎 하위 문제 (${q.subQuestions.length}개):`);
    for (const sq of q.subQuestions) {
      const instruction = sq.question.substring(0, 60);
      lines.push(`  • [${sq.originalNumber}] ${instruction}...`);
      
      if (sq.choices && sq.choices.length > 0) {
        for (const c of sq.choices.slice(0, 3)) {
          const choiceText = c.text.substring(0, 30);
          lines.push(`      ${c.symbol} ${choiceText}...`);
        }
      }
    }
  }
  
  if (q.footnotes && q.footnotes.length > 0) {
    lines.push('\n📌 주석:');
    for (const fn of q.footnotes) {
      lines.push(`  ${fn}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * 편집용 데이터 형식으로 변환
 * 각 필드에 편집 가능 여부 메타데이터 추가
 */
export function parseForEditing(text: string): (AppQuestion & { _meta: any })[] {
  const questions = parseQuestions(text);
  
  return questions.map(q => ({
    ...q,
    _meta: {
      editableFields: ['question', 'passage', 'image', 'points', 'answer'],
      choiceCount: q.choices?.length || 0,
      hasSubPassages: q.type === 'combined',
      validationStatus: validateSingleQuestion(q),
    }
  }));
}

/**
 * 단일 문제 검증
 */
function validateSingleQuestion(q: AppQuestion): 'valid' | 'warning' | 'error' {
  if (!q.question && q.type !== 'combined') return 'error';
  
  if (q.type === 'multiple_choice') {
    const choices = q.choices || [];
    if (choices.length === 0) return 'error';
    if (choices.length < 5) return 'warning';
  }
  
  if (q.type === 'combined') {
    const subs = q.subQuestions || [];
    if (subs.length < 2) return 'warning';
    if (!q.passage) return 'warning';
  }
  
  return 'valid';
}

// ============================================================================
// 기본 내보내기
// ============================================================================

export default {
  parseQuestions,
  parseToJSON,
  validateQuestions,
  formatForDisplay,
  parseForEditing,
};
