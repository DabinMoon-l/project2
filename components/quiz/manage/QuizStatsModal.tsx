/**
 * 퀴즈 통계 모달
 *
 * 학생이 만든 퀴즈의 참여자 통계를 표시합니다.
 * - 참여자 수, 평균/최고/최저 점수
 * - 오답률 Top 3
 * - 문제별 분석 (스와이프/드롭다운)
 * - 반별 필터링 (전체/A/B/C/D)
 */

'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  query,
  where,
  doc,
  getDoc,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatChapterLabel } from '@/lib/courseIndex';
import { useCustomFolders } from '@/lib/hooks/useCustomFolders';
import FolderSelectModal from '@/components/common/FolderSelectModal';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

// 모듈 레벨 classId 캐시 (모달 닫았다 열어도 유지, 페이지 이동 시에도 유지)
const _statsUserClassCache = new Map<string, 'A' | 'B' | 'C' | 'D' | null>();
// 모듈 레벨 이름 캐시
const _statsUserNameCache = new Map<string, string>();

// ============================================================
// 애니메이션 컴포넌트
// ============================================================

/**
 * 숫자 카운트업 애니메이션 컴포넌트
 */
function CountUp({ value, duration = 1000, className }: { value: number; duration?: number; className?: string }) {
  const [displayValue, setDisplayValue] = useState(0);
  const startTime = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);

  useEffect(() => {
    startTime.current = null;

    const animate = (timestamp: number) => {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);

      // easeOutQuart for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplayValue(Math.round(eased * value));

      if (progress < 1) {
        animationFrame.current = requestAnimationFrame(animate);
      }
    };

    animationFrame.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    };
  }, [value, duration]);

  return <span className={className}>{displayValue}</span>;
}

/**
 * 반별 참여 파이차트 (클릭으로 필터링)
 */
function ClassPieChart({
  counts,
  selectedClass,
  onSelectClass,
}: {
  counts: Record<string, number>;
  selectedClass: string;
  onSelectClass: (classType: string) => void;
}) {
  const total = counts.A + counts.B + counts.C + counts.D;

  // 반별 색상 (온보딩 원색 기준)
  const classColors: Record<string, string> = {
    A: '#EF4444', // 빨강
    B: '#EAB308', // 노랑
    C: '#22C55E', // 초록
    D: '#3B82F6', // 파랑
  };

  // 파이 조각 계산
  const classes = ['A', 'B', 'C', 'D'] as const;
  let currentAngle = -90; // 12시 방향에서 시작

  const slices = classes.map((cls) => {
    const count = counts[cls] || 0;
    const percentage = total > 0 ? (count / total) * 100 : 25;
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    return {
      class: cls,
      count,
      percentage,
      startAngle,
      endAngle,
      color: classColors[cls],
    };
  });

  // SVG 파이 조각 경로 생성
  const createSlicePath = (startAngle: number, endAngle: number, radius: number, innerRadius: number = 0) => {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = 50 + radius * Math.cos(startRad);
    const y1 = 50 + radius * Math.sin(startRad);
    const x2 = 50 + radius * Math.cos(endRad);
    const y2 = 50 + radius * Math.sin(endRad);

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    if (innerRadius > 0) {
      const ix1 = 50 + innerRadius * Math.cos(startRad);
      const iy1 = 50 + innerRadius * Math.sin(startRad);
      const ix2 = 50 + innerRadius * Math.cos(endRad);
      const iy2 = 50 + innerRadius * Math.sin(endRad);

      return `M ${ix1} ${iy1} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
    }

    return `M 50 50 L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="relative w-24 h-24">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle cx="50" cy="50" r="40" fill="#D4CFC4" />
            <circle cx="50" cy="50" r="25" fill="#F5F0E8" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-[#5C5C5C]">없음</span>
          </div>
        </div>
        <button
          onClick={() => onSelectClass('all')}
          className={`px-3 py-1 text-sm border-2 transition-all ${
            selectedClass === 'all'
              ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
              : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A]'
          }`}
        >
          전체 (0)
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {slices.map((slice) => (
            <motion.path
              key={slice.class}
              d={createSlicePath(slice.startAngle, slice.endAngle, 40, 20)}
              fill={slice.color}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: selectedClass === 'all' || selectedClass === slice.class ? 1 : 0.3,
                scale: selectedClass === slice.class ? 1.05 : 1,
              }}
              whileHover={{ scale: 1.08, opacity: 1 }}
              transition={{ duration: 0.2 }}
              onClick={() => onSelectClass(selectedClass === slice.class ? 'all' : slice.class)}
              className="cursor-pointer"
              style={{ transformOrigin: '50px 50px' }}
            />
          ))}
          {/* 중앙 원 */}
          <circle cx="50" cy="50" r="18" fill="#F5F0E8" />
        </svg>
        {/* 중앙 텍스트 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg font-bold text-[#1A1A1A]">{total}</p>
            <p className="text-[10px] text-[#5C5C5C]">명</p>
          </div>
        </div>
      </div>

      {/* 범례 + 전체 버튼 */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <button
          onClick={() => onSelectClass('all')}
          className={`px-2 py-0.5 text-xs border transition-all ${
            selectedClass === 'all'
              ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
              : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A]'
          }`}
        >
          전체
        </button>
        {slices.map((slice) => (
          <button
            key={slice.class}
            onClick={() => onSelectClass(selectedClass === slice.class ? 'all' : slice.class)}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs border transition-all ${
              selectedClass === slice.class
                ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A]'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: slice.color }}
            />
            {slice.class}({slice.count})
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 타입 정의
// ============================================================

interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QuizStatsModalProps {
  quizId: string;
  quizTitle: string;
  isOpen: boolean;
  onClose: () => void;
  isProfessor?: boolean;
  sourceRect?: SourceRect | null;
}

interface LabeledItem {
  label: string;
  content: string;
}

interface BogiData {
  questionText: string;
  items: LabeledItem[];
}

interface MixedExampleItem {
  id: string;
  type: 'text' | 'labeled' | 'gana' | 'bullet' | 'image' | 'grouped';
  label?: string;
  content?: string;
  items?: LabeledItem[];
  imageUrl?: string;
  children?: MixedExampleItem[];
}

interface FlattenedQuestion {
  id: string;
  text: string;
  type: 'ox' | 'multiple' | 'short_answer' | 'short' | 'essay';
  choices?: string[];
  answer?: string;
  chapterId?: string;
  chapterDetailId?: string;
  // 이미지
  imageUrl?: string;
  // 제시문 관련
  mixedExamples?: MixedExampleItem[];
  passagePrompt?: string;
  // 보기 관련
  bogi?: BogiData | null;
  // 결합형 그룹 정보
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  // 공통 지문 정보 (첫 번째 하위 문제에만)
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  // 해설
  explanation?: string;
  choiceExplanations?: string[];
  // 문제 수정 시간 (수정된 문제만)
  questionUpdatedAt?: number;
}

interface QuestionStats {
  questionId: string;
  questionIndex: number;
  questionText: string;
  questionType: string;
  correctRate: number;
  wrongRate: number;
  discrimination: number;
  totalAttempts: number;
  correctCount: number;
  correctAnswer?: string;
  choices?: string[];
  chapterId?: string;
  chapterDetailId?: string;
  // 이미지
  imageUrl?: string;
  // 제시문 관련
  mixedExamples?: MixedExampleItem[];
  passagePrompt?: string;
  // 보기 정보
  bogi?: BogiData | null;
  // 결합형 공통 지문
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  // 해설
  explanation?: string;
  choiceExplanations?: string[];
  // OX 선택 분포
  oxDistribution?: { o: number; x: number };
  // 객관식 선지별 선택 분포
  optionDistribution?: { option: string; count: number; isCorrect: boolean; percentage: number }[];
  // 주관식 오답 목록
  wrongAnswers?: { answer: string; count: number }[];
  // 서술형 답변 목록
  essayAnswers?: { answer: string; userId: string }[];
}

interface QuizStats {
  participantCount: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  questionStats: QuestionStats[];
  courseId?: string;
}

interface ResultWithClass {
  userId: string;
  classType: 'A' | 'B' | 'C' | 'D' | null;
  score: number;
  questionScores: Record<string, { isCorrect: boolean; userAnswer: string; answeredAt?: any }>;
  createdAt?: any;
}

type ClassFilter = 'all' | 'A' | 'B' | 'C' | 'D';

const CLASS_FILTERS: { value: ClassFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'A', label: 'A반' },
  { value: 'B', label: 'B반' },
  { value: 'C', label: 'C반' },
  { value: 'D', label: 'D반' },
];

// ============================================================
// 헬퍼 함수
// ============================================================

/**
 * questions 배열을 펼쳐서 결합형 하위 문제들을 개별 문제로 변환
 *
 * 중요: ID 생성 시 result 페이지와 동일한 로직 사용 (q.id || `q${index}`)
 */
/**
 * 객관식 answer를 0-indexed에서 1-indexed 문자열로 변환
 * 예: 2 → "3", [0, 2] → "1,3"
 */
function convertAnswerTo1Indexed(type: string, answer: any): string | undefined {
  if (answer === null || answer === undefined) return undefined;
  if (type !== 'multiple') return answer?.toString();

  // 이미 1-indexed 문자열인 경우 (예: "3" 또는 "1,3")
  if (typeof answer === 'string') {
    // 숫자 문자열이면 0-indexed일 수 있으므로 변환
    // 하지만 문자열로 저장된 경우 이미 변환된 것일 수 있어 판단이 어려움
    // → Firestore에서 answer는 항상 number/number[]로 저장되므로, 문자열이면 이미 변환된 것
    return answer;
  }

  if (Array.isArray(answer)) {
    return answer.map((a: number) => a + 1).join(',');
  }
  if (typeof answer === 'number') {
    return (answer + 1).toString();
  }
  return answer?.toString();
}

/**
 * questionUpdatedAt 타임스탬프를 밀리초로 변환
 */
function toMillis(ts: any): number {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (typeof ts === 'number') return ts;
  return 0;
}

function flattenQuestions(questions: any[]): FlattenedQuestion[] {
  const result: FlattenedQuestion[] = [];

  questions.forEach((q, index) => {
    // 결과 페이지와 동일한 ID fallback 로직 사용
    const questionId = q.id || `q${index}`;

    // 이미 펼쳐진 결합형 문제 (combinedGroupId가 있는 경우)
    if (q.combinedGroupId) {
      result.push({
        id: questionId,
        text: q.text || '',
        type: q.type,
        choices: q.choices,
        answer: convertAnswerTo1Indexed(q.type, q.answer),
        chapterId: q.chapterId,
        chapterDetailId: q.chapterDetailId,
        imageUrl: q.imageUrl,
        mixedExamples: q.mixedExamples,
        passagePrompt: q.passagePrompt,
        bogi: q.bogi,
        combinedGroupId: q.combinedGroupId,
        combinedIndex: q.combinedIndex,
        combinedTotal: q.combinedTotal,
        passage: q.combinedIndex === 0 ? q.passage : undefined,
        passageType: q.combinedIndex === 0 ? q.passageType : undefined,
        passageImage: q.combinedIndex === 0 ? q.passageImage : undefined,
        koreanAbcItems: q.combinedIndex === 0 ? q.koreanAbcItems : undefined,
        explanation: q.explanation,
        choiceExplanations: q.choiceExplanations,
        questionUpdatedAt: toMillis(q.questionUpdatedAt) || undefined,
      });
    }
    // 레거시 결합형 문제 (type === 'combined' + subQuestions)
    else if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      const groupId = `legacy_${questionId}`;
      q.subQuestions.forEach((sq: any, idx: number) => {
        const updatedAt = toMillis(sq.questionUpdatedAt || q.questionUpdatedAt);
        result.push({
          id: sq.id || `${questionId}_sub${idx}`,
          text: sq.text || '',
          type: sq.type || 'short_answer',
          choices: sq.choices,
          answer: sq.answerIndices?.length > 0
            ? sq.answerIndices.map((i: number) => i + 1).join(',')
            : sq.answerIndex !== undefined
              ? (sq.answerIndex + 1).toString()
              : sq.answerText,
          chapterId: q.chapterId,
          imageUrl: sq.imageUrl,
          mixedExamples: sq.mixedExamples,
          passagePrompt: sq.passagePrompt,
          bogi: sq.bogi,
          combinedGroupId: groupId,
          combinedIndex: idx,
          combinedTotal: q.subQuestions.length,
          passage: idx === 0 ? q.passage : undefined,
          passageType: idx === 0 ? q.passageType : undefined,
          passageImage: idx === 0 ? q.passageImage : undefined,
          koreanAbcItems: idx === 0 ? q.koreanAbcItems : undefined,
          explanation: sq.explanation,
          choiceExplanations: sq.choiceExplanations,
          questionUpdatedAt: updatedAt || undefined,
        });
      });
    }
    // 일반 문제
    else {
      result.push({
        id: questionId,
        text: q.text || '',
        type: q.type,
        choices: q.choices,
        answer: convertAnswerTo1Indexed(q.type, q.answer),
        chapterId: q.chapterId,
        chapterDetailId: q.chapterDetailId,
        imageUrl: q.imageUrl,
        mixedExamples: q.mixedExamples,
        passagePrompt: q.passagePrompt,
        bogi: q.bogi,
        explanation: q.explanation,
        choiceExplanations: q.choiceExplanations,
        questionUpdatedAt: toMillis(q.questionUpdatedAt) || undefined,
      });
    }
  });

  return result;
}

/**
 * 혼합 보기 항목이 유효한지 확인
 */
function isValidMixedItem(item: MixedExampleItem): boolean {
  switch (item.type) {
    case 'text':
      return Boolean(item.content?.trim());
    case 'labeled':
    case 'gana':
    case 'bullet':
      return Boolean(item.content?.trim()) ||
             Boolean(item.items?.some(i => i.content.trim()));
    case 'image':
      return Boolean(item.imageUrl);
    case 'grouped':
      return Boolean(item.children?.length && item.children.some(child => isValidMixedItem(child)));
    default:
      return false;
  }
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 통계 모달
 */
export default function QuizStatsModal({
  quizId,
  quizTitle,
  isOpen,
  onClose,
  isProfessor = false,
  sourceRect = null,
}: QuizStatsModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [showQuestionDropdown, setShowQuestionDropdown] = useState(false);

  // 폴더 저장
  const { customFolders, createCustomFolder, addToCustomFolder } = useCustomFolders();
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderSaveToast, setFolderSaveToast] = useState<string | null>(null);

  // 피드백 모달
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackList, setFeedbackList] = useState<any[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSourceRect, setFeedbackSourceRect] = useState<SourceRect | null>(null);

  // 서술형 답안 모달
  const [showEssayModal, setShowEssayModal] = useState(false);
  const [essayClassFilter, setEssayClassFilter] = useState<'A' | 'B' | 'C' | 'D'>('A');

  // 문제 스와이프 (가로 슬라이드)
  const questionContentRef = useRef<HTMLDivElement>(null);
  const slideEnterFromRef = useRef<'left' | 'right' | null>(null);
  const swipeTransitioning = useRef(false);
  const swipeRef = useRef({
    startX: 0,
    startY: 0,
    direction: 'none' as 'none' | 'horizontal' | 'vertical',
    offsetX: 0,
  });

  // 원본 데이터
  const [questions, setQuestions] = useState<FlattenedQuestion[]>([]);
  const [resultsWithClass, setResultsWithClass] = useState<ResultWithClass[]>([]);
  const [courseId, setCourseId] = useState<string | undefined>();

  // 모달이 열릴 때 문제 인덱스 리셋
  useEffect(() => {
    if (isOpen) {
      setSelectedQuestionIndex(0);
    }
  }, [isOpen]);

  // 모달 열림 시 body 스크롤 완전 잠금
  useEffect(() => {
    if (!isOpen) return;
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    // classId 캐시 (모듈 레벨 — 모달을 닫았다 다시 열어도 유지)
    const userClassCache = _statsUserClassCache;

    const setup = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. 퀴즈 데이터 가져오기 (1회)
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (!quizDoc.exists()) {
          setError('퀴즈를 찾을 수 없습니다.');
          setLoading(false);
          return;
        }

        const quizData = quizDoc.data();
        const flatQuestions = flattenQuestions(quizData.questions || []);
        setQuestions(flatQuestions);
        setCourseId(quizData.courseId);

        // 2. 퀴즈 결과 1회성 조회 (onSnapshot → getDocs: 읽기 전용 통계이므로 실시간 불필요)
        const resultsQuery = query(
          collection(db, 'quizResults'),
          where('quizId', '==', quizId)
        );

        const resultsSnapshot = await getDocs(resultsQuery);

        // 첫 번째 결과만 필터링 (isUpdate가 아닌 것)
        const firstResults = resultsSnapshot.docs.filter(
          (d) => !d.data().isUpdate
        );

        if (firstResults.length === 0) {
          setResultsWithClass([]);
          setLoading(false);
          return;
        }

        // userId 중복 제거 — 동일 사용자의 가장 최근 결과만 사용
        const latestByUser = new Map<string, any>();
        firstResults.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          const uid = data.userId;
          const ts = data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || 0;
          const existing = latestByUser.get(uid);
          if (!existing || ts > (existing.data.createdAt?.toMillis?.() || existing.data.createdAt?.seconds * 1000 || 0)) {
            latestByUser.set(uid, { docSnapshot, data });
          }
        });
        const dedupedResults = Array.from(latestByUser.values());

        // 결과에서 classId 추출 (없으면 배치로 users 컬렉션에서 가져오기)
        const resultsNeedingClass: { data: any }[] = [];
        const resultsWithClassDirect: ResultWithClass[] = [];

        dedupedResults.forEach(({ data }) => {
          if (data.classId) {
            resultsWithClassDirect.push({
              userId: data.userId,
              classType: data.classId as 'A' | 'B' | 'C' | 'D',
              score: data.score || 0,
              questionScores: data.questionScores || {},
              createdAt: data.createdAt,
            });
          } else if (userClassCache.has(data.userId)) {
            resultsWithClassDirect.push({
              userId: data.userId,
              classType: userClassCache.get(data.userId) || null,
              score: data.score || 0,
              questionScores: data.questionScores || {},
              createdAt: data.createdAt,
            });
          } else {
            resultsNeedingClass.push({ data });
          }
        });

        // classId가 없는 결과들에 대해 배치로 조회 (N+1 → 30개씩 배치 쿼리)
        const userIds = [...new Set(resultsNeedingClass.map((r) => r.data.userId))];

        if (userIds.length > 0) {
          // 30개씩 배치로 쿼리 (Firestore 'in' 제한)
          for (let i = 0; i < userIds.length; i += 30) {
            const batch = userIds.slice(i, i + 30);
            const batchResults = await Promise.all(
              batch.map(async (userId) => {
                try {
                  const userDoc = await getDoc(doc(db, 'users', userId));
                  const userData = userDoc.exists() ? userDoc.data() : null;
                  // 이름도 캐시
                  if (userData?.name) _statsUserNameCache.set(userId, userData.name);
                  return { userId, classId: userData?.classId || null };
                } catch {
                  return { userId, classId: null };
                }
              })
            );
            batchResults.forEach(({ userId, classId }) => {
              userClassCache.set(userId, classId);
            });
          }
        }

        // 결과에 classType 추가
        const resultsFromUsers: ResultWithClass[] = resultsNeedingClass.map(({ data }) => ({
          userId: data.userId,
          classType: userClassCache.get(data.userId) || null,
          score: data.score || 0,
          questionScores: data.questionScores || {},
          createdAt: data.createdAt,
        }));

        const results: ResultWithClass[] = [...resultsWithClassDirect, ...resultsFromUsers];
        setResultsWithClass(results);
        setLoading(false);
      } catch (err) {
        console.error('통계 로드 실패:', err);
        setError('통계를 불러오는데 실패했습니다.');
        setLoading(false);
      }
    };

    setup();
  }, [isOpen, quizId]);

  // 필터링된 결과 기반으로 통계 계산
  const stats = useMemo<QuizStats | null>(() => {
    if (questions.length === 0) return null;

    // 반별 필터링
    const filteredResults =
      classFilter === 'all'
        ? resultsWithClass
        : resultsWithClass.filter((r) => r.classType === classFilter);

    if (filteredResults.length === 0) {
      return {
        participantCount: 0,
        averageScore: 0,
        highestScore: 0,
        lowestScore: 0,
        courseId,
        questionStats: questions.map((q, idx) => ({
          questionId: `${q.id}_${idx}`,
          questionIndex: idx,
          questionText: q.text || '',
          questionType: q.type || 'multiple',
          correctRate: 0,
          wrongRate: 100,
          discrimination: 0,
          totalAttempts: 0,
          correctCount: 0,
          correctAnswer: q.answer,
          choices: q.choices,
          chapterId: q.chapterId,
          chapterDetailId: q.chapterDetailId,
          imageUrl: q.imageUrl,
          mixedExamples: q.mixedExamples,
          passagePrompt: q.passagePrompt,
          bogi: q.bogi,
          passage: q.passage,
          passageType: q.passageType,
          passageImage: q.passageImage,
          koreanAbcItems: q.koreanAbcItems,
          explanation: q.explanation,
          choiceExplanations: q.choiceExplanations,
        })),
      };
    }

    // 문제 ID → 문제 객체 맵 (O(1) 룩업용)
    const questionMap = new Map<string, FlattenedQuestion>();
    const questionUpdatedAtMap = new Map<string, number>();
    questions.forEach((q) => {
      questionMap.set(q.id, q);
      if (q.questionUpdatedAt) {
        questionUpdatedAtMap.set(q.id, q.questionUpdatedAt);
      }
    });

    // 통계 계산
    // 참여자 수/점수: 모든 유니크 사용자 포함 (수정 문제 풀었든 안 풀었든)
    // 문제별 정답률/선지: 수정된 문제는 수정 후 응답만, 비수정 문제는 전체
    const scores: number[] = [];
    const questionCorrectCounts: Record<string, number> = {};
    const questionAttemptCounts: Record<string, number> = {};
    // 유저별 정답(1)/오답(0) 기록 — 변별도 계산용
    const questionScoreArrays: Record<string, number[]> = {};
    // 유저별 총점 — 변별도에서 상/하위 구분용
    const userTotalScores: Record<string, number> = {};
    const oxSelections: Record<string, { o: number; x: number }> = {};
    const optionSelections: Record<string, Record<string, number>> = {};
    const shortAnswerResponses: Record<string, Record<string, number>> = {};
    const essayResponses: Record<string, { answer: string; userId: string }[]> = {};

    // 변별도 계산용: 문제별로 { userId, isCorrect }[] 기록
    const questionUserScores: Record<string, { userId: string; isCorrect: boolean }[]> = {};

    filteredResults.forEach((result) => {
      scores.push(result.score);
      userTotalScores[result.userId] = result.score;

      // 문제별 점수 분석
      Object.entries(result.questionScores).forEach(
        ([questionId, scoreData]) => {
          const question = questionMap.get(questionId);
          if (!question) return;

          // 수정된 문제의 경우 수정 이후 응답만 포함
          const updatedAt = questionUpdatedAtMap.get(questionId);
          if (updatedAt) {
            const answeredAt = toMillis(scoreData.answeredAt) || toMillis(result.createdAt);
            if (answeredAt > 0 && answeredAt < updatedAt) return;
          }

          if (!questionCorrectCounts[questionId]) {
            questionCorrectCounts[questionId] = 0;
            questionAttemptCounts[questionId] = 0;
            questionScoreArrays[questionId] = [];
            questionUserScores[questionId] = [];
          }
          questionAttemptCounts[questionId]++;
          questionScoreArrays[questionId].push(scoreData.isCorrect ? 1 : 0);
          questionUserScores[questionId].push({ userId: result.userId, isCorrect: scoreData.isCorrect });
          if (scoreData.isCorrect) {
            questionCorrectCounts[questionId]++;
          }

          // OX 선택 분포
          if (question.type === 'ox') {
            if (!oxSelections[questionId]) {
              oxSelections[questionId] = { o: 0, x: 0 };
            }
            const answer = scoreData.userAnswer?.toString().toUpperCase();
            if (answer === 'O' || answer === '0') {
              oxSelections[questionId].o++;
            } else if (answer === 'X' || answer === '1') {
              oxSelections[questionId].x++;
            }
          }

          // 객관식 선지 분포
          if (question.type === 'multiple' && scoreData.userAnswer) {
            if (!optionSelections[questionId]) {
              optionSelections[questionId] = {};
            }
            // 복수 선택 지원
            const answers = scoreData.userAnswer.toString().split(',').map((a: string) => a.trim());
            answers.forEach((ans: string) => {
              optionSelections[questionId][ans] = (optionSelections[questionId][ans] || 0) + 1;
            });
          }

          // 주관식 응답 수집 (오답만)
          if ((question.type === 'short_answer' || question.type === 'short') && !scoreData.isCorrect && scoreData.userAnswer) {
            if (!shortAnswerResponses[questionId]) {
              shortAnswerResponses[questionId] = {};
            }
            const userAnswer = scoreData.userAnswer.toString().trim().toLowerCase() || '(미입력)';
            shortAnswerResponses[questionId][userAnswer] = (shortAnswerResponses[questionId][userAnswer] || 0) + 1;
          }

          // 서술형 답변 수집 (미응답도 포함)
          if (question.type === 'essay') {
            if (!essayResponses[questionId]) {
              essayResponses[questionId] = [];
            }
            essayResponses[questionId].push({
              answer: scoreData.userAnswer ? scoreData.userAnswer.toString() : '',
              userId: result.userId,
            });
          }
        }
      );
    });

    // 평균/최고/최저 점수
    const averageScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    // 문제별 통계
    const questionStats: QuestionStats[] = questions.map((q, idx) => {
      const attempts = questionAttemptCounts[q.id] || 0;
      const correct = questionCorrectCounts[q.id] || 0;
      const correctRate = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;
      const wrongRate = 100 - correctRate;

      // 변별도 계산 (상위 27% 정답률 - 하위 27% 정답률)
      let discrimination = 0;
      const userScores = questionUserScores[q.id];
      if (userScores && userScores.length >= 4) {
        // 총점 기준 정렬
        const sorted = [...userScores].sort(
          (a, b) => (userTotalScores[b.userId] ?? 0) - (userTotalScores[a.userId] ?? 0)
        );
        const n27 = Math.max(1, Math.ceil(sorted.length * 0.27));
        const upper = sorted.slice(0, n27);
        const lower = sorted.slice(-n27);
        const upperRate = upper.filter(u => u.isCorrect).length / upper.length;
        const lowerRate = lower.filter(u => u.isCorrect).length / lower.length;
        discrimination = Math.round((upperRate - lowerRate) * 100) / 100;
      }

      const stat: QuestionStats = {
        questionId: `${q.id}_${idx}`,
        questionIndex: idx,
        questionText: q.text || '',
        questionType: q.type || 'multiple',
        correctRate,
        wrongRate,
        discrimination,
        totalAttempts: attempts,
        correctCount: correct,
        correctAnswer: q.answer,
        choices: q.choices,
        chapterId: q.chapterId,
        chapterDetailId: q.chapterDetailId,
        imageUrl: q.imageUrl,
        mixedExamples: q.mixedExamples,
        passagePrompt: q.passagePrompt,
        bogi: q.bogi,
        passage: q.passage,
        passageType: q.passageType,
        passageImage: q.passageImage,
        koreanAbcItems: q.koreanAbcItems,
        explanation: q.explanation,
        choiceExplanations: q.choiceExplanations,
      };

      // OX 분포
      if (q.type === 'ox' && oxSelections[q.id]) {
        stat.oxDistribution = oxSelections[q.id];
      }

      // 객관식 선지 분포
      if (q.type === 'multiple' && q.choices) {
        const selections = optionSelections[q.id] || {};
        const correctAnswers = q.answer?.split(',').map((a) => a.trim()) || [];

        // 총 선택 수 계산 (모든 선지 선택의 합)
        const totalSelections = Object.values(selections).reduce((sum, count) => sum + count, 0);

        stat.optionDistribution = q.choices.map((choice, optIdx) => {
          const optionNum = (optIdx + 1).toString();
          const count = selections[optionNum] || 0;
          // 총 선택 수 기준으로 퍼센트 계산 (합이 100%가 되도록)
          const percentage = totalSelections > 0 ? Math.round((count / totalSelections) * 100) : 0;
          const isCorrect = correctAnswers.includes(optionNum);
          return { option: choice, count, isCorrect, percentage };
        });
      }

      // 주관식 오답 목록
      if ((q.type === 'short_answer' || q.type === 'short') && shortAnswerResponses[q.id]) {
        stat.wrongAnswers = Object.entries(shortAnswerResponses[q.id])
          .map(([answer, count]) => ({ answer, count }))
          .sort((a, b) => b.count - a.count);
      }

      // 서술형 답변 목록
      if (q.type === 'essay' && essayResponses[q.id]) {
        stat.essayAnswers = essayResponses[q.id];
      }

      return stat;
    });

    return {
      participantCount: scores.length,
      averageScore,
      highestScore,
      lowestScore,
      courseId,
      questionStats,
    };
  }, [questions, resultsWithClass, classFilter, courseId]);

  // 반별 참여자 수 계산 (모든 유니크 사용자 포함)
  const classParticipantCounts = useMemo(() => {
    const counts: Record<ClassFilter, number> = {
      all: resultsWithClass.length,
      A: 0,
      B: 0,
      C: 0,
      D: 0,
    };

    resultsWithClass.forEach((r) => {
      if (r.classType && counts[r.classType] !== undefined) {
        counts[r.classType]++;
      }
    });

    return counts;
  }, [resultsWithClass]);

  // 오답률 Top 3 계산
  const wrongRateTop3 = useMemo(() => {
    if (!stats) return [];
    return [...stats.questionStats]
      .sort((a, b) => b.wrongRate - a.wrongRate)
      .slice(0, 3)
      .map((q, idx) => ({
        rank: idx + 1,
        questionNum: stats.questionStats.findIndex(s => s.questionId === q.questionId) + 1,
        wrongRate: q.wrongRate,
      }));
  }, [stats]);

  // 문제 유형 라벨
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'ox': return 'OX';
      case 'multiple': return '객관식';
      case 'short_answer':
      case 'short': return '주관식';
      case 'essay': return '서술형';
      default: return type;
    }
  };

  // 문제 전환 (비스와이프: 즉시)
  const goToQuestion = useCallback((newIdx: number) => {
    if (newIdx === selectedQuestionIndex) return;
    setSelectedQuestionIndex(newIdx);
  }, [selectedQuestionIndex]);

  // 스와이프 슬라이드 인 애니메이션
  useLayoutEffect(() => {
    const enterFrom = slideEnterFromRef.current;
    if (!enterFrom || !questionContentRef.current) return;
    slideEnterFromRef.current = null;

    const el = questionContentRef.current;
    const startX = enterFrom === 'left' ? '-100%' : '100%';
    el.style.transition = 'none';
    el.style.transform = `translateX(${startX})`;
    el.getBoundingClientRect();
    el.style.transition = 'transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translateX(0)';

    const cleanup = () => {
      el.style.transition = '';
      el.style.transform = '';
      swipeTransitioning.current = false;
    };
    el.addEventListener('transitionend', cleanup, { once: true });
    const timer = setTimeout(cleanup, 350);
    return () => clearTimeout(timer);
  }, [selectedQuestionIndex]);

  // 문제 영역 터치 핸들러
  const handleQSwipeStart = useCallback((e: React.TouchEvent) => {
    if (swipeTransitioning.current) return;
    const s = swipeRef.current;
    s.startX = scaleCoord(e.touches[0].clientX);
    s.startY = scaleCoord(e.touches[0].clientY);
    s.direction = 'none';
    s.offsetX = 0;
  }, []);

  const handleQSwipeMove = useCallback((e: React.TouchEvent) => {
    if (swipeTransitioning.current) return;
    const s = swipeRef.current;
    const deltaX = scaleCoord(e.touches[0].clientX) - s.startX;
    const deltaY = scaleCoord(e.touches[0].clientY) - s.startY;

    // 방향 잠금
    if (s.direction === 'none') {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;
      s.direction = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }

    if (s.direction !== 'horizontal' || !questionContentRef.current) return;

    const totalQ = stats?.questionStats.length || 0;
    const isAtStart = selectedQuestionIndex === 0;
    const isAtEnd = selectedQuestionIndex >= totalQ - 1;

    if ((isAtStart && deltaX > 0) || (isAtEnd && deltaX < 0)) {
      s.offsetX = deltaX * 0.15;
    } else {
      s.offsetX = deltaX * 0.5;
    }

    questionContentRef.current.style.transition = 'none';
    questionContentRef.current.style.transform = `translateX(${s.offsetX}px)`;
  }, [selectedQuestionIndex, stats]);

  const handleQSwipeEnd = useCallback(() => {
    const s = swipeRef.current;
    if (s.direction !== 'horizontal' || !questionContentRef.current) {
      s.direction = 'none';
      return;
    }

    const el = questionContentRef.current;
    const deltaX = s.offsetX;
    s.direction = 'none';

    const SWIPE_THRESHOLD = 60;
    const totalQ = stats?.questionStats.length || 0;

    if (deltaX < -SWIPE_THRESHOLD && selectedQuestionIndex < totalQ - 1) {
      // 왼쪽 스와이프 → 다음 문제
      swipeTransitioning.current = true;
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = `translateX(${-el.offsetWidth}px)`;
      setTimeout(() => {
        slideEnterFromRef.current = 'right';
        setSelectedQuestionIndex(selectedQuestionIndex + 1);
      }, 200);
      return;
    }

    if (deltaX > SWIPE_THRESHOLD && selectedQuestionIndex > 0) {
      // 오른쪽 스와이프 → 이전 문제
      swipeTransitioning.current = true;
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = `translateX(${el.offsetWidth}px)`;
      setTimeout(() => {
        slideEnterFromRef.current = 'left';
        setSelectedQuestionIndex(selectedQuestionIndex - 1);
      }, 200);
      return;
    }

    // 원위치 복귀
    el.style.transition = 'transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translateX(0)';
  }, [selectedQuestionIndex, stats]);

  // 현재 선택된 문제
  const currentQuestion = stats?.questionStats[selectedQuestionIndex];

  // 혼합 보기 유효성 검사
  const hasValidMixedExamples = currentQuestion?.mixedExamples &&
    currentQuestion.mixedExamples.length > 0 &&
    currentQuestion.mixedExamples.some(item => isValidMixedItem(item));

  // 피드백 로드
  const handleOpenFeedback = useCallback(async (rect?: SourceRect) => {
    if (rect) setFeedbackSourceRect(rect);
    setShowFeedbackModal(true);
    setFeedbackLoading(true);
    try {
      const feedbacksRef = collection(db, 'questionFeedbacks');
      const q = query(feedbacksRef, where('quizId', '==', quizId));
      const snapshot = await getDocs(q);

      const items: any[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        items.push({
          id: d.id,
          ...data,
          feedbackType: data.type || data.feedbackType,
          feedback: data.content || data.feedback || '',
        });
      });

      // 최신순 정렬
      items.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });

      setFeedbackList(items);
    } catch (err) {
      console.error('피드백 로드 실패:', err);
    } finally {
      setFeedbackLoading(false);
    }
  }, [quizId]);

  // 현재 문제를 폴더에 저장
  const handleFolderSelect = async (folderId: string) => {
    if (!currentQuestion) return;
    try {
      await addToCustomFolder(folderId, [{
        questionId: currentQuestion.questionId,
        quizId: quizId,
        quizTitle: quizTitle,
        combinedGroupId: null,
      }]);
      setShowFolderModal(false);
      setFolderSaveToast('폴더에 추가되었습니다');
      setTimeout(() => setFolderSaveToast(null), 2000);
    } catch {
      setFolderSaveToast('추가에 실패했습니다');
      setTimeout(() => setFolderSaveToast(null), 2000);
    }
  };

  // 요술지니 애니메이션 계산 (sourceRect → 화면 중앙)
  const genieOffset = useMemo(() => {
    if (!sourceRect || typeof window === 'undefined') return { dx: 0, dy: 0 };
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    return {
      dx: sourceRect.x + sourceRect.width / 2 - cx,
      dy: sourceRect.y + sourceRect.height / 2 - cy,
    };
  }, [sourceRect]);

  return (
    <AnimatePresence>
    {isOpen && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 overflow-hidden overscroll-none"
      style={{ left: 'var(--modal-left, 0px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.05, x: genieOffset.dx, y: genieOffset.dy }}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, scale: 0.05, x: genieOffset.dx, y: genieOffset.dy }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#F5F0E8] border-2 border-[#1A1A1A] h-[82vh] overflow-hidden flex flex-col rounded-xl"
      >
        {/* 헤더 */}
        <div className="px-3 py-2 border-b-2 border-[#1A1A1A] flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-bold text-[#1A1A1A] flex-1 pr-3 truncate">{quizTitle}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 반별 필터 탭 — 교수님만 표시 */}
        {isProfessor && (
          <div className="flex border-b border-[#D4CFC4] flex-shrink-0 bg-[#EDEAE4]">
            {CLASS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setClassFilter(filter.value)}
                className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                  classFilter === filter.value
                    ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A] bg-[#F5F0E8]'
                    : 'text-[#5C5C5C] hover:text-[#1A1A1A]'
                }`}
              >
                {filter.label}
                <span className="ml-0.5 text-[10px]">
                  ({classParticipantCounts[filter.value]})
                </span>
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8 flex-shrink-0">
            <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-center py-8 flex-shrink-0">
            <p className="text-sm text-[#8B1A1A]">{error}</p>
          </div>
        )}

        {!loading && !error && stats && (
          <>
            {/* 요약 카드 — 고정 */}
            <div className="flex-shrink-0 px-3 pt-2 pb-1">
              <div className="grid grid-cols-4 gap-1 p-2 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">참여자</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    <CountUp key={`participant-${classFilter}`} value={stats.participantCount} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">평균</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    <CountUp key={`average-${classFilter}`} value={stats.averageScore} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">최고</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    <CountUp key={`highest-${classFilter}`} value={stats.highestScore} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">최저</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    <CountUp key={`lowest-${classFilter}`} value={stats.lowestScore} duration={800} />
                  </p>
                </div>
              </div>
            </div>

            {/* 문제별 분석 */}
            {stats.questionStats.length > 0 && (
              <div className="flex-1 flex flex-col min-h-0 mx-3 mb-2 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                {/* 슬라이더 헤더 — 고정 */}
                <div className="flex-shrink-0 px-3 py-2 border-b border-[#1A1A1A] bg-[#F5F0E8]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-[#1A1A1A]">Q{selectedQuestionIndex + 1}.</span>
                    <span className="text-xs text-[#5C5C5C]">{stats.questionStats.length}문제</span>
                  </div>
                    {/* 슬라이더 + 킬러 마커 */}
                    {stats.questionStats.length > 1 && (() => {
                      const totalQ = stats.questionStats.length;
                      const markers = wrongRateTop3
                        .map((item) => ({
                          ...item,
                          position: ((item.questionNum - 1) / (totalQ - 1)) * 100,
                          correctRate: 100 - item.wrongRate,
                        }))
                        .sort((a, b) => a.position - b.position);

                      // 겹침 감지: 인접 마커 간 거리가 20% 미만이면 위아래 교대 배치
                      const needsStagger = markers.length > 1 && markers.some((m, i) =>
                        i > 0 && (m.position - markers[i - 1].position) < 20
                      );

                      const renderMarker = (item: typeof markers[0], placeAbove: boolean) => {
                        const rankLabel = item.rank === 1 ? '1st' : item.rank === 2 ? '2nd' : '3rd';
                        const align = item.position < 8 ? 'translateX(0)' : item.position > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
                        return (
                          <span
                            key={item.rank}
                            onClick={() => goToQuestion(item.questionNum - 1)}
                            className="absolute text-[10px] font-bold text-[#1A1A1A] cursor-pointer hover:text-[#5C5C5C] text-center leading-tight whitespace-nowrap"
                            style={{
                              left: `${item.position}%`,
                              transform: align,
                              ...(placeAbove
                                ? { bottom: '100%', marginBottom: '2px' }
                                : { top: '100%', marginTop: '2px' }),
                            }}
                          >
                            {rankLabel}<br />{item.correctRate}%
                          </span>
                        );
                      };

                      return (
                        <div>
                          <div
                            className="relative"
                            style={{
                              marginTop: needsStagger ? '28px' : '0',
                              marginBottom: markers.length > 0 ? '24px' : '0',
                            }}
                          >
                            <input
                              type="range"
                              min={0}
                              max={totalQ - 1}
                              value={selectedQuestionIndex}
                              onChange={(e) => goToQuestion(parseInt(e.target.value))}
                              className="w-full h-2 bg-[#D4CFC4] appearance-none cursor-pointer accent-[#1A1A1A] relative z-10"
                              style={{
                                background: `linear-gradient(to right, #1A1A1A 0%, #1A1A1A ${(selectedQuestionIndex / (totalQ - 1)) * 100}%, #D4CFC4 ${(selectedQuestionIndex / (totalQ - 1)) * 100}%, #D4CFC4 100%)`
                              }}
                            />
                            {/* 킬러 마커 */}
                            {markers.map((item, idx) =>
                              renderMarker(item, needsStagger && idx % 2 === 0)
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* 문제 상세 — 남은 공간에서 스크롤 */}
                  {currentQuestion && (
                    <div
                      className="relative flex-1 min-h-0 overflow-hidden"
                      onTouchStart={handleQSwipeStart}
                      onTouchMove={handleQSwipeMove}
                      onTouchEnd={handleQSwipeEnd}
                      style={{ touchAction: 'pan-y' }}
                    >
                      {/* 피드백 아이콘 (좌측 상단) */}
                      <button
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          handleOpenFeedback({ x: r.x, y: r.y, width: r.width, height: r.height });
                        }}
                        className="absolute top-1 left-1 z-10 w-8 h-8 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
                        title="피드백 보기"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                        </svg>
                      </button>
                      {/* 서술형 답안 확인 아이콘 (피드백 아이콘 우측) */}
                      {currentQuestion.questionType === 'essay' && (
                        <button
                          onClick={() => setShowEssayModal(true)}
                          className="absolute top-1 left-9 z-10 w-8 h-8 flex items-center justify-center text-[#8B6914] hover:text-[#6B4F0E] transition-colors"
                          title="서술형 답안 보기"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </button>
                      )}
                      {/* 폴더 저장 아이콘 (우측 상단) — 교수님 전용 */}
                      {isProfessor && (
                        <button
                          onClick={() => setShowFolderModal(true)}
                          className="absolute top-1 right-1 z-10 w-8 h-8 flex items-center justify-center text-[#8B6914] hover:text-[#6B4F0E] transition-colors"
                          title="폴더에 저장"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                          </svg>
                        </button>
                      )}
                      <div
                        ref={questionContentRef}
                        className="h-full overflow-y-auto overflow-x-hidden scrollbar-hide overscroll-contain"
                      >
                      {/* 참여자가 없는 반일 경우 */}
                      {stats.participantCount === 0 ? (
                        <div className="h-full flex items-center justify-center">
                          <p className="text-sm text-[#5C5C5C]">
                            {classFilter === 'all' ? '참여자가 없습니다.' : `${classFilter}반 참여자가 없습니다.`}
                          </p>
                        </div>
                      ) : (
                      <div className="p-3 min-h-full flex flex-col justify-center items-stretch">
                        {/* 문제 헤더 */}
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <span className="text-sm font-bold text-[#1A1A1A]">
                            정답률 {currentQuestion.correctRate}%
                          </span>
                          {currentQuestion.totalAttempts >= 4 && (() => {
                            const d = currentQuestion.discrimination;
                            const label = d >= 0.4 ? '우수' : d >= 0.2 ? '양호' : d >= 0 ? '미흡' : '역변별';
                            const color = d >= 0.4 ? '#16A34A' : d >= 0.2 ? '#1A1A1A' : d >= 0 ? '#D97706' : '#DC2626';
                            return (
                              <>
                                <span className="text-xs text-[#5C5C5C]">·</span>
                                <span className="text-xs font-bold" style={{ color }}>
                                  변별도 {d.toFixed(2)} <span className="text-[10px] font-normal">({label})</span>
                                </span>
                              </>
                            );
                          })()}
                        </div>

                        {/* 문제 텍스트 (박스 없이) */}
                        <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap mb-3">{currentQuestion.questionText || '(문제 텍스트 없음)'}</p>

                        {/* 결합형 공통 지문 */}
                        {(currentQuestion.passage || currentQuestion.passageImage || (currentQuestion.koreanAbcItems && currentQuestion.koreanAbcItems.length > 0)) && (
                          <div className="space-y-3 mb-4">
                            {/* 텍스트 형식 공통 지문 */}
                            {currentQuestion.passage && (!currentQuestion.passageType || currentQuestion.passageType === 'text') && (
                              <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A] rounded-lg">
                                <p className="text-[10px] text-[#5C5C5C] mb-1 font-bold">공통 제시문</p>
                                <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap">{currentQuestion.passage}</p>
                              </div>
                            )}

                            {/* ㄱㄴㄷ 형식 공통 지문 */}
                            {currentQuestion.passageType === 'korean_abc' && currentQuestion.koreanAbcItems && currentQuestion.koreanAbcItems.length > 0 && (
                              <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A] space-y-0.5 rounded-lg">
                                <p className="text-[10px] text-[#5C5C5C] mb-1 font-bold">제시문</p>
                                {currentQuestion.koreanAbcItems.filter(i => i.trim()).map((item, idx) => (
                                  <p key={idx} className="text-xs text-[#1A1A1A]">
                                    <span className="font-bold mr-1">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.</span>
                                    {item}
                                  </p>
                                ))}
                              </div>
                            )}

                            {/* 공통 이미지 */}
                            {currentQuestion.passageImage && (
                              <div className="relative overflow-hidden bg-[#F5F0E8] border border-[#1A1A1A] rounded-lg">
                                <p className="absolute top-2 left-2 text-xs text-[#5C5C5C] font-bold bg-[#F5F0E8]/80 px-2 py-0.5 z-10">공통 이미지</p>
                                <img
                                  src={currentQuestion.passageImage}
                                  alt="공통 이미지"
                                  className="w-full h-auto object-contain max-h-40"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* 혼합 보기 (grouped) */}
                        {hasValidMixedExamples && currentQuestion.mixedExamples!
                          .filter(item => item.type === 'grouped' && isValidMixedItem(item))
                          .map((item) => (
                            <div key={item.id} className="mb-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1 rounded-lg">
                              {item.children?.filter(child => isValidMixedItem(child)).map((child) => (
                                <div key={child.id}>
                                  {child.type === 'text' && child.content && (
                                    <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                                  )}
                                  {child.type === 'labeled' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">{child.label}.</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem, idx) => (
                                        <p key={idx} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">{labeledItem.label}.</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'gana' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">({child.label})</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem, idx) => (
                                        <p key={idx} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">({labeledItem.label})</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'bullet' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">◦</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem, idx) => (
                                        <p key={idx} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">◦</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'image' && child.imageUrl && (
                                    <img src={child.imageUrl} alt="제시문 이미지" className="w-full max-w-xs h-auto border border-[#1A1A1A] rounded-lg" />
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}

                        {/* 나머지 제시문 (grouped 제외) */}
                        {hasValidMixedExamples && currentQuestion.mixedExamples!
                          .filter(item => item.type !== 'grouped' && isValidMixedItem(item))
                          .map((item) => {
                            if (item.type === 'text') {
                              return (
                                <div key={item.id} className="mb-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A] rounded-lg">
                                  <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap">{item.content}</p>
                                </div>
                              );
                            }
                            if (item.type === 'labeled') {
                              return (
                                <div key={item.id} className="mb-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1 rounded-lg">
                                  {item.content && (
                                    <p className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">{item.label}.</span>{item.content}
                                    </p>
                                  )}
                                  {item.items?.map((labeledItem, idx) => (
                                    <p key={idx} className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">{labeledItem.label}.</span>{labeledItem.content}
                                    </p>
                                  ))}
                                </div>
                              );
                            }
                            if (item.type === 'gana') {
                              return (
                                <div key={item.id} className="mb-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1 rounded-lg">
                                  {item.content && (
                                    <p className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">({item.label})</span>{item.content}
                                    </p>
                                  )}
                                  {item.items?.map((labeledItem, idx) => (
                                    <p key={idx} className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">({labeledItem.label})</span>{labeledItem.content}
                                    </p>
                                  ))}
                                </div>
                              );
                            }
                            return null;
                          })}

                        {/* 문제 이미지 */}
                        {currentQuestion.imageUrl && (
                          <div className="mb-2 overflow-hidden bg-[#F5F0E8] border border-[#1A1A1A] rounded-lg">
                            <img
                              src={currentQuestion.imageUrl}
                              alt="문제 이미지"
                              className="w-full h-auto object-contain max-h-32"
                            />
                          </div>
                        )}

                        {/* 보기 (<보기> 박스) */}
                        {currentQuestion.bogi && currentQuestion.bogi.items && currentQuestion.bogi.items.some(i => i.content?.trim()) && (
                          <div className="mb-2 p-2 bg-[#F5F0E8] border-2 border-[#1A1A1A] rounded-lg">
                            <p className="text-[10px] text-center text-[#5C5C5C] mb-1.5 font-bold">&lt;보 기&gt;</p>
                            <div className="space-y-1">
                              {currentQuestion.bogi.items.filter(i => i.content?.trim()).map((item) => (
                                <p key={item.label} className="text-xs text-[#1A1A1A]">
                                  <span className="font-bold mr-1">{item.label}.</span>
                                  {item.content}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 발문 (제시문 발문 + 보기 발문) */}
                        {(currentQuestion.passagePrompt || currentQuestion.bogi?.questionText) && (
                          <p className="mb-2 text-xs text-[#1A1A1A]">
                            {currentQuestion.passagePrompt && currentQuestion.bogi?.questionText
                              ? `${currentQuestion.passagePrompt} ${currentQuestion.bogi.questionText}`
                              : currentQuestion.passagePrompt || currentQuestion.bogi?.questionText}
                          </p>
                        )}

                        {/* OX 선지 */}
                        {currentQuestion.questionType === 'ox' && (() => {
                          const oCount = currentQuestion.oxDistribution?.o || 0;
                          const xCount = currentQuestion.oxDistribution?.x || 0;
                          const totalSelections = oCount + xCount;

                          const correctAnswer = currentQuestion.correctAnswer?.toUpperCase() === 'O' ||
                            currentQuestion.correctAnswer === '0' ? 'O' : 'X';

                          const oPercentage = totalSelections > 0 ? Math.round((oCount / totalSelections) * 100) : 0;
                          const xPercentage = totalSelections > 0 ? Math.round((xCount / totalSelections) * 100) : 0;

                          return (
                            <div className="flex gap-3 justify-center py-2 mb-2">
                              {['O', 'X'].map((opt) => {
                                const isCorrect = opt === correctAnswer;
                                const percentage = opt === 'O' ? oPercentage : xPercentage;

                                return (
                                  <div
                                    key={opt}
                                    className={`relative w-16 h-16 text-2xl font-bold border-2 overflow-hidden ${
                                      isCorrect ? 'border-[#1A6B1A]' : 'border-[#8B1A1A]'
                                    }`}
                                    style={{ backgroundColor: '#EDEAE4' }}
                                  >
                                    {percentage > 0 && (
                                      <motion.div
                                        initial={{ height: 0 }}
                                        animate={{ height: `${percentage}%` }}
                                        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                                        className={`absolute left-0 right-0 bottom-0 ${isCorrect ? 'bg-[#E8F5E9]' : 'bg-[#FDEAEA]'}`}
                                      />
                                    )}
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                      <span className={`relative z-10 ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>{opt}</span>
                                      <span className={`relative z-10 text-[10px] font-normal ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>{percentage}%</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 객관식 선지 */}
                        {currentQuestion.questionType === 'multiple' && currentQuestion.optionDistribution && (() => {
                          const wrongOptions = currentQuestion.optionDistribution.filter(o => !o.isCorrect);
                          const maxWrongPercentage = wrongOptions.length > 0
                            ? Math.max(...wrongOptions.map(o => o.percentage))
                            : 0;
                          const choiceExpls = currentQuestion.choiceExplanations;

                          return (
                            <div className="space-y-1 mb-2">
                              {currentQuestion.optionDistribution.map((opt, optIdx) => {
                                const isHighestWrong = !opt.isCorrect && opt.percentage === maxWrongPercentage && maxWrongPercentage > 0;
                                const choiceExpl = choiceExpls?.[optIdx];

                                return (
                                  <div key={optIdx}>
                                    <div
                                      className={`relative flex items-center gap-2 px-2 py-1.5 border overflow-hidden ${
                                        opt.isCorrect ? 'border-[#1A6B1A]' : isHighestWrong ? 'border-[#8B1A1A]' : 'border-[#D4CFC4]'
                                      }`}
                                      style={{ backgroundColor: '#F5F0E8' }}
                                    >
                                      {opt.percentage > 0 && (
                                        <motion.div
                                          initial={{ width: 0 }}
                                          animate={{ width: `${opt.percentage}%` }}
                                          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 + optIdx * 0.05 }}
                                          className={`absolute left-0 top-0 bottom-0 ${opt.isCorrect ? 'bg-[#E8F5E9]' : 'bg-[#FDEAEA]'}`}
                                        />
                                      )}
                                      <span className={`relative z-10 text-xs font-bold min-w-[18px] ${
                                        opt.isCorrect ? 'text-[#1A6B1A]' : isHighestWrong ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'
                                      }`}>
                                        {optIdx + 1}.
                                      </span>
                                      <span className="relative z-10 flex-1 text-xs text-[#1A1A1A]">{opt.option}</span>
                                      <span className={`relative z-10 text-xs font-bold ${
                                        opt.isCorrect ? 'text-[#1A6B1A]' : isHighestWrong ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'
                                      }`}>
                                        {opt.percentage}%
                                      </span>
                                    </div>
                                    {isProfessor && choiceExpl && (
                                      <p className="mt-0.5 ml-2 text-[10px] text-[#5C5C5C] italic">{choiceExpl}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 주관식 */}
                        {(currentQuestion.questionType === 'short_answer' || currentQuestion.questionType === 'short') && (
                          <div className="space-y-1.5 mb-2">
                            <div className="p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                              <span className="text-xs text-[#1A6B1A] font-bold">정답: </span>
                              <span className="text-xs text-[#1A6B1A]">
                                {currentQuestion.correctAnswer?.includes('|||')
                                  ? currentQuestion.correctAnswer.split('|||').map(a => a.trim()).join(', ')
                                  : currentQuestion.correctAnswer || '-'}
                              </span>
                            </div>
                            {currentQuestion.wrongAnswers && currentQuestion.wrongAnswers.length > 0 && (
                              <div className="p-2 bg-[#FDEAEA] border border-[#8B1A1A]">
                                <span className="text-xs text-[#8B1A1A] font-bold">오답: </span>
                                <span className="text-xs text-[#8B1A1A]">
                                  {currentQuestion.wrongAnswers.slice(0, 5).map(w => w.answer).join(', ')}
                                  {currentQuestion.wrongAnswers.length > 5 && ` 외 ${currentQuestion.wrongAnswers.length - 5}개`}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 해설 — 교수님만 표시 */}
                        {isProfessor && (
                          <div className="mt-2 p-2 border border-dashed border-[#A0A0A0] bg-[#FDFBF7]">
                            <p className="text-[10px] font-bold text-[#5C5C5C] mb-0.5">해설</p>
                            {currentQuestion.explanation ? (
                              <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap">{currentQuestion.explanation}</p>
                            ) : (
                              <p className="text-xs text-[#A0A0A0] italic">해설 없음</p>
                            )}
                          </div>
                        )}

                      </div>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

      </motion.div>

      {/* 피드백 모달 */}
      <AnimatePresence>
        {showFeedbackModal && (() => {
          const sr = feedbackSourceRect;
          const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
          const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
          const fdx = sr ? (sr.x + sr.width / 2 - cx) : 0;
          const fdy = sr ? (sr.y + sr.height / 2 - cy) : 0;
          return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/50"
            style={{ left: 'var(--modal-left, 0px)' }}
            onClick={(e) => { e.stopPropagation(); setShowFeedbackModal(false); setFeedbackList([]); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.05, x: fdx, y: fdy }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.05, x: fdx, y: fdy }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[60vh] overflow-visible flex flex-col rounded-xl"
            >
              <div className="px-3 py-2 border-b border-[#1A1A1A]">
                <h2 className="text-sm font-bold text-[#1A1A1A] text-center truncate">{quizTitle}</h2>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain p-2">
                {feedbackLoading && (
                  <div className="py-6 text-center">
                    <p className="text-xs text-[#5C5C5C]">로딩 중...</p>
                  </div>
                )}

                {!feedbackLoading && feedbackList.length === 0 && (
                  <div className="py-6 text-center">
                    <p className="text-xs text-[#5C5C5C]">아직 피드백이 없습니다.</p>
                  </div>
                )}

                {!feedbackLoading && feedbackList.length > 0 && (
                  <div className="space-y-1.5">
                    {feedbackList.map((feedback) => {
                      const typeLabels: Record<string, string> = {
                        praise: '문제가 좋아요!',
                        wantmore: '더 풀고 싶어요',
                        unclear: '문제가 이해가 안 돼요',
                        wrong: '정답이 틀린 것 같아요',
                        typo: '오타가 있어요',
                        other: '기타 의견',
                      };
                      const typeLabel = typeLabels[feedback.feedbackType] || feedback.feedbackType || '피드백';
                      let questionNum = 0;
                      if (feedback.questionNumber && feedback.questionNumber > 0 && feedback.questionNumber < 1000) {
                        questionNum = feedback.questionNumber;
                      } else if (feedback.questionId) {
                        const match = feedback.questionId.match(/^q(\d{1,3})$/);
                        if (match) {
                          questionNum = parseInt(match[1], 10) + 1;
                        }
                      }

                      return (
                        <div
                          key={feedback.id}
                          className="p-1.5 border border-[#1A1A1A] bg-[#EDEAE4] rounded-lg"
                        >
                          {questionNum > 0 && (
                            <p className="text-[10px] text-[#5C5C5C] mb-0.5">
                              문제 {questionNum}.
                            </p>
                          )}
                          <p className="text-[11px] font-bold text-[#8B6914] mb-0.5">
                            {typeLabel}
                          </p>
                          {feedback.feedback && (
                            <p className="text-[11px] text-[#1A1A1A]">
                              {feedback.feedback}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-1.5 border-t border-[#1A1A1A]">
                <button
                  onClick={() => { setShowFeedbackModal(false); setFeedbackList([]); }}
                  className="w-full py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] rounded-lg"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* 서술형 답안 모달 */}
      <AnimatePresence>
        {showEssayModal && currentQuestion?.essayAnswers && (() => {
          const ESSAY_CLASS_FILTERS: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
          const classColors: Record<string, string> = { A: '#EF4444', B: '#EAB308', C: '#22C55E', D: '#3B82F6' };
          // essayClassFilter로 필터링
          const filtered = currentQuestion.essayAnswers!.filter(ea => {
            const cls = _statsUserClassCache.get(ea.userId);
            return cls === essayClassFilter;
          });
          return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/50"
            style={{ left: 'var(--modal-left, 0px)' }}
            onClick={(e) => { e.stopPropagation(); setShowEssayModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[70vh] overflow-visible flex flex-col rounded-xl"
            >
              {/* 헤더 */}
              <div className="px-3 py-2 border-b border-[#1A1A1A]">
                <h2 className="text-sm font-bold text-[#1A1A1A] text-center">서술형 답안</h2>
              </div>

              {/* ABCD 필터 */}
              <div className="flex border-b border-[#D4CFC4]">
                {ESSAY_CLASS_FILTERS.map((cls) => (
                  <button
                    key={cls}
                    onClick={() => setEssayClassFilter(cls)}
                    className={`flex-1 py-2 text-xs font-bold transition-colors ${
                      essayClassFilter === cls
                        ? 'text-[#F5F0E8]'
                        : 'text-[#5C5C5C] hover:bg-[#EDEAE4]'
                    }`}
                    style={essayClassFilter === cls ? { backgroundColor: classColors[cls] } : undefined}
                  >
                    {cls}반
                  </button>
                ))}
              </div>

              {/* 답안 목록 */}
              <div className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-2">
                {filtered.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-xs text-[#5C5C5C]">{essayClassFilter}반 응답이 없습니다.</p>
                  </div>
                ) : (
                  filtered.map((ea, idx) => {
                    const name = _statsUserNameCache.get(ea.userId) || '(알 수 없음)';
                    return (
                      <div key={idx} className="p-2 border border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                        <p className="text-xs font-bold text-[#1A1A1A] mb-1">{name}</p>
                        <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">
                          {ea.answer || '(미응답)'}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 닫기 */}
              <div className="p-1.5 border-t border-[#1A1A1A]">
                <button
                  onClick={() => setShowEssayModal(false)}
                  className="w-full py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] rounded-lg"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* 폴더 선택 모달 */}
      <FolderSelectModal
        isOpen={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        onSelect={handleFolderSelect}
        folders={customFolders}
        onCreateFolder={createCustomFolder}
      />

      {/* 폴더 저장 토스트 */}
      <AnimatePresence>
        {folderSaveToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-0 right-0 mx-auto w-fit z-[110] px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold rounded-lg"
          >
            {folderSaveToast}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
