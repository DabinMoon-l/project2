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

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { formatChapterLabel } from '@/lib/courseIndex';

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

interface QuizStatsModalProps {
  quizId: string;
  quizTitle: string;
  isOpen: boolean;
  onClose: () => void;
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
}

interface QuestionStats {
  questionId: string;
  questionIndex: number;
  questionText: string;
  questionType: string;
  correctRate: number;
  wrongRate: number;
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
  // OX 선택 분포
  oxDistribution?: { o: number; x: number };
  // 객관식 선지별 선택 분포
  optionDistribution?: { option: string; count: number; isCorrect: boolean; percentage: number }[];
  // 주관식 오답 목록
  wrongAnswers?: { answer: string; count: number }[];
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
  questionScores: Record<string, { isCorrect: boolean; userAnswer: string }>;
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
        answer: q.answer?.toString(),
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
      });
    }
    // 레거시 결합형 문제 (type === 'combined' + subQuestions)
    else if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      const groupId = `legacy_${questionId}`;
      q.subQuestions.forEach((sq: any, idx: number) => {
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
        answer: q.answer?.toString(),
        chapterId: q.chapterId,
        chapterDetailId: q.chapterDetailId,
        imageUrl: q.imageUrl,
        mixedExamples: q.mixedExamples,
        passagePrompt: q.passagePrompt,
        bogi: q.bogi,
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
}: QuizStatsModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [showQuestionDropdown, setShowQuestionDropdown] = useState(false);

  // 스와이프 상태
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // 호버 상태
  const [isHovering, setIsHovering] = useState(false);

  // 슬라이드 방향 (1: 오른쪽으로, -1: 왼쪽으로)
  const [slideDirection, setSlideDirection] = useState(0);

  // 스와이프 감지 최소 거리
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && stats && selectedQuestionIndex < stats.questionStats.length - 1) {
      setSlideDirection(1);
      setSelectedQuestionIndex(prev => prev + 1);
    }
    if (isRightSwipe && selectedQuestionIndex > 0) {
      setSlideDirection(-1);
      setSelectedQuestionIndex(prev => prev - 1);
    }
  };

  // 원본 데이터
  const [questions, setQuestions] = useState<FlattenedQuestion[]>([]);
  const [resultsWithClass, setResultsWithClass] = useState<ResultWithClass[]>([]);
  const [courseId, setCourseId] = useState<string | undefined>();

  // 모달이 열릴 때 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', 'true');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. 퀴즈 데이터 가져오기
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (!quizDoc.exists()) {
          setError('퀴즈를 찾을 수 없습니다.');
          return;
        }

        const quizData = quizDoc.data();
        const flatQuestions = flattenQuestions(quizData.questions || []);
        setQuestions(flatQuestions);
        setCourseId(quizData.courseId);

        // 2. 퀴즈 결과 가져오기
        const resultsQuery = query(
          collection(db, 'quizResults'),
          where('quizId', '==', quizId)
        );
        const resultsSnapshot = await getDocs(resultsQuery);

        // 첫 번째 결과만 필터링 (isUpdate가 아닌 것)
        const firstResults = resultsSnapshot.docs.filter(
          (doc) => !doc.data().isUpdate
        );

        if (firstResults.length === 0) {
          setResultsWithClass([]);
          setLoading(false);
          return;
        }

        // 3. 결과에서 classId 추출 (없으면 users 컬렉션에서 가져오기)
        const resultsNeedingClass: { docSnapshot: any; data: any }[] = [];
        const resultsWithClassDirect: ResultWithClass[] = [];

        firstResults.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          if (data.classId) {
            // quizResults에 classId가 있으면 바로 사용
            resultsWithClassDirect.push({
              userId: data.userId,
              classType: data.classId as 'A' | 'B' | 'C' | 'D',
              score: data.score || 0,
              questionScores: data.questionScores || {},
            });
          } else {
            // classId가 없으면 나중에 users에서 가져오기
            resultsNeedingClass.push({ docSnapshot, data });
          }
        });

        // classId가 없는 결과들에 대해 users 컬렉션에서 가져오기
        const userIds = [...new Set(resultsNeedingClass.map((r) => r.data.userId))];
        const userClassMap = new Map<string, 'A' | 'B' | 'C' | 'D' | null>();

        if (userIds.length > 0) {
          await Promise.all(
            userIds.map(async (userId) => {
              try {
                const userDoc = await getDoc(doc(db, 'users', userId));
                if (userDoc.exists()) {
                  userClassMap.set(userId, userDoc.data().classId || null);
                } else {
                  userClassMap.set(userId, null);
                }
              } catch {
                userClassMap.set(userId, null);
              }
            })
          );
        }

        // 4. 결과에 classType 추가
        const resultsFromUsers: ResultWithClass[] = resultsNeedingClass.map(({ data }) => {
          return {
            userId: data.userId,
            classType: userClassMap.get(data.userId) || null,
            score: data.score || 0,
            questionScores: data.questionScores || {},
          };
        });

        const results: ResultWithClass[] = [...resultsWithClassDirect, ...resultsFromUsers];

        setResultsWithClass(results);
      } catch (err) {
        console.error('통계 로드 실패:', err);
        setError('통계를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
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
        })),
      };
    }

    // 통계 계산
    const scores: number[] = [];
    const questionCorrectCounts: Record<string, number> = {};
    const questionAttemptCounts: Record<string, number> = {};
    const oxSelections: Record<string, { o: number; x: number }> = {};
    const optionSelections: Record<string, Record<string, number>> = {};
    const shortAnswerResponses: Record<string, Record<string, number>> = {};

    filteredResults.forEach((result) => {
      scores.push(result.score);

      // 문제별 점수 분석
      Object.entries(result.questionScores).forEach(
        ([questionId, scoreData]) => {
          if (!questionCorrectCounts[questionId]) {
            questionCorrectCounts[questionId] = 0;
            questionAttemptCounts[questionId] = 0;
          }
          questionAttemptCounts[questionId]++;
          if (scoreData.isCorrect) {
            questionCorrectCounts[questionId]++;
          }

          const question = questions.find((q) => q.id === questionId);
          if (!question) return;

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
            const userAnswer = scoreData.userAnswer.toString().trim() || '(미입력)';
            shortAnswerResponses[questionId][userAnswer] = (shortAnswerResponses[questionId][userAnswer] || 0) + 1;
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

      const stat: QuestionStats = {
        questionId: `${q.id}_${idx}`,
        questionIndex: idx,
        questionText: q.text || '',
        questionType: q.type || 'multiple',
        correctRate,
        wrongRate,
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

  // 반별 참여자 수 계산
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

  // 이전/다음 문제
  const goToPrevQuestion = () => {
    if (selectedQuestionIndex > 0) {
      setSlideDirection(-1);
      setSelectedQuestionIndex(prev => prev - 1);
    }
  };

  const goToNextQuestion = () => {
    if (stats && selectedQuestionIndex < stats.questionStats.length - 1) {
      setSlideDirection(1);
      setSelectedQuestionIndex(prev => prev + 1);
    }
  };

  // 현재 선택된 문제
  const currentQuestion = stats?.questionStats[selectedQuestionIndex];

  // 혼합 보기 유효성 검사
  const hasValidMixedExamples = currentQuestion?.mixedExamples &&
    currentQuestion.mixedExamples.length > 0 &&
    currentQuestion.mixedExamples.some(item => isValidMixedItem(item));

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[95vh] overflow-hidden flex flex-col"
      >
        {/* 헤더 */}
        <div className="p-4 border-b-2 border-[#1A1A1A] flex items-center justify-between flex-shrink-0">
          <h2 className="text-xl font-bold text-[#1A1A1A] flex-1 pr-4 truncate">{quizTitle}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] flex-shrink-0"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 반별 필터 탭 */}
        <div className="flex border-b border-[#D4CFC4] flex-shrink-0 bg-[#EDEAE4]">
          {CLASS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setClassFilter(filter.value)}
              className={`flex-1 py-3 text-base font-medium transition-colors ${
                classFilter === filter.value
                  ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A] bg-[#F5F0E8]'
                  : 'text-[#5C5C5C] hover:text-[#1A1A1A]'
              }`}
            >
              {filter.label}
              <span className="ml-0.5 text-sm">
                ({classParticipantCounts[filter.value]})
              </span>
            </button>
          ))}
        </div>

        {/* 컨텐츠 */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent animate-spin" />
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <p className="text-[#8B1A1A]">{error}</p>
            </div>
          )}

          {!loading && !error && stats && (
            <div className="p-4 space-y-4">
              {/* 요약 카드 */}
              <div className="grid grid-cols-4 gap-2 p-4 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <div className="text-center">
                  <p className="text-sm text-[#5C5C5C]">참여자</p>
                  <p className="text-4xl font-bold text-[#1A1A1A]">
                    <CountUp key={`participant-${classFilter}`} value={stats.participantCount} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-[#5C5C5C]">평균</p>
                  <p className="text-4xl font-bold text-[#1A1A1A]">
                    <CountUp key={`average-${classFilter}`} value={stats.averageScore} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-[#5C5C5C]">최고</p>
                  <p className="text-4xl font-bold text-[#1A1A1A]">
                    <CountUp key={`highest-${classFilter}`} value={stats.highestScore} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-[#5C5C5C]">최저</p>
                  <p className="text-4xl font-bold text-[#1A1A1A]">
                    <CountUp key={`lowest-${classFilter}`} value={stats.lowestScore} duration={800} />
                  </p>
                </div>
              </div>

              {/* 문제별 분석 */}
              {stats.questionStats.length > 0 && (
                <div className="border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                  {/* 헤더: 문제 슬라이더 */}
                  <div className="p-4 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-3xl font-bold text-[#1A1A1A]">Q{selectedQuestionIndex + 1}.</span>
                      <span className="text-base text-[#5C5C5C]">{stats.questionStats.length}문제 중</span>
                    </div>
                    {stats.questionStats.length > 1 && (
                      <input
                        type="range"
                        min={0}
                        max={stats.questionStats.length - 1}
                        value={selectedQuestionIndex}
                        onChange={(e) => {
                          const newIdx = parseInt(e.target.value);
                          setSlideDirection(newIdx > selectedQuestionIndex ? 1 : -1);
                          setSelectedQuestionIndex(newIdx);
                        }}
                        className="w-full h-2 bg-[#D4CFC4] appearance-none cursor-pointer accent-[#1A1A1A]"
                        style={{
                          background: `linear-gradient(to right, #1A1A1A 0%, #1A1A1A ${(selectedQuestionIndex / (stats.questionStats.length - 1)) * 100}%, #D4CFC4 ${(selectedQuestionIndex / (stats.questionStats.length - 1)) * 100}%, #D4CFC4 100%)`
                        }}
                      />
                    )}
                  </div>

                  {/* 현재 문제 정보 - 고정 높이 스크롤 영역 + 스와이프 지원 */}
                  {currentQuestion && (
                    <div className="relative h-[600px]">
                      <div
                        className="h-full overflow-y-auto"
                        onTouchStart={onTouchStart}
                        onTouchMove={onTouchMove}
                        onTouchEnd={onTouchEnd}
                      >
                      {/* 참여자가 없는 반일 경우 */}
                      {stats.participantCount === 0 ? (
                        <div className="h-full flex items-center justify-center">
                          <p className="text-lg text-[#5C5C5C]">
                            {classFilter === 'all' ? '참여자가 없습니다.' : `${classFilter}반 참여자가 없습니다.`}
                          </p>
                        </div>
                      ) : (
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={selectedQuestionIndex}
                          initial={{ opacity: 0, x: slideDirection * 50 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -slideDirection * 50 }}
                          transition={{ duration: 0.2, ease: 'easeOut' }}
                          className="min-h-full flex flex-col justify-center p-4"
                        >
                        {/* 문제 헤더 */}
                        <div className="flex items-center justify-center mb-4">
                          <span className="text-xl font-bold text-[#1A1A1A]">
                            정답률 {currentQuestion.correctRate}%
                          </span>
                        </div>

                        {/* 문제 텍스트 (박스 없이) */}
                        <p className="text-base text-[#1A1A1A] whitespace-pre-wrap mb-4 text-center">{currentQuestion.questionText || '(문제 텍스트 없음)'}</p>

                        {/* 결합형 공통 지문 */}
                        {(currentQuestion.passage || currentQuestion.passageImage || (currentQuestion.koreanAbcItems && currentQuestion.koreanAbcItems.length > 0)) && (
                          <div className="space-y-3 mb-4">
                            {/* 텍스트 형식 공통 지문 */}
                            {currentQuestion.passage && (!currentQuestion.passageType || currentQuestion.passageType === 'text') && (
                              <div className="p-3 bg-[#F5F0E8] border border-[#1A1A1A]">
                                <p className="text-sm text-[#5C5C5C] mb-2 font-bold">공통 제시문</p>
                                <p className="text-base text-[#1A1A1A] whitespace-pre-wrap">{currentQuestion.passage}</p>
                              </div>
                            )}

                            {/* ㄱㄴㄷ 형식 공통 지문 */}
                            {currentQuestion.passageType === 'korean_abc' && currentQuestion.koreanAbcItems && currentQuestion.koreanAbcItems.length > 0 && (
                              <div className="p-3 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1">
                                <p className="text-sm text-[#5C5C5C] mb-2 font-bold">제시문</p>
                                {currentQuestion.koreanAbcItems.filter(i => i.trim()).map((item, idx) => (
                                  <p key={idx} className="text-base text-[#1A1A1A]">
                                    <span className="font-bold mr-1">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.</span>
                                    {item}
                                  </p>
                                ))}
                              </div>
                            )}

                            {/* 공통 이미지 */}
                            {currentQuestion.passageImage && (
                              <div className="relative overflow-hidden bg-[#F5F0E8] border border-[#1A1A1A]">
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
                            <div key={item.id} className="mb-4 p-4 bg-[#F5F0E8] border border-[#1A1A1A] space-y-2">
                              {item.children?.filter(child => isValidMixedItem(child)).map((child) => (
                                <div key={child.id}>
                                  {child.type === 'text' && child.content && (
                                    <p className="text-[#5C5C5C] text-base whitespace-pre-wrap">{child.content}</p>
                                  )}
                                  {child.type === 'labeled' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-base">
                                          <span className="font-bold mr-1">{child.label}.</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem, idx) => (
                                        <p key={idx} className="text-[#1A1A1A] text-base">
                                          <span className="font-bold mr-1">{labeledItem.label}.</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'gana' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-base">
                                          <span className="font-bold mr-1">({child.label})</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem, idx) => (
                                        <p key={idx} className="text-[#1A1A1A] text-base">
                                          <span className="font-bold mr-1">({labeledItem.label})</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'bullet' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-base">
                                          <span className="font-bold mr-1">◦</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem, idx) => (
                                        <p key={idx} className="text-[#1A1A1A] text-base">
                                          <span className="font-bold mr-1">◦</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'image' && child.imageUrl && (
                                    <img src={child.imageUrl} alt="제시문 이미지" className="w-full max-w-xs h-auto border border-[#1A1A1A]" />
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
                                <div key={item.id} className="mb-4 p-4 bg-[#F5F0E8] border border-[#1A1A1A]">
                                  <p className="text-base text-[#1A1A1A] whitespace-pre-wrap">{item.content}</p>
                                </div>
                              );
                            }
                            if (item.type === 'labeled') {
                              return (
                                <div key={item.id} className="mb-4 p-4 bg-[#F5F0E8] border border-[#1A1A1A] space-y-2">
                                  {item.content && (
                                    <p className="text-base text-[#1A1A1A]">
                                      <span className="font-bold mr-1">{item.label}.</span>{item.content}
                                    </p>
                                  )}
                                  {item.items?.map((labeledItem, idx) => (
                                    <p key={idx} className="text-base text-[#1A1A1A]">
                                      <span className="font-bold mr-1">{labeledItem.label}.</span>{labeledItem.content}
                                    </p>
                                  ))}
                                </div>
                              );
                            }
                            if (item.type === 'gana') {
                              return (
                                <div key={item.id} className="mb-4 p-4 bg-[#F5F0E8] border border-[#1A1A1A] space-y-2">
                                  {item.content && (
                                    <p className="text-base text-[#1A1A1A]">
                                      <span className="font-bold mr-1">({item.label})</span>{item.content}
                                    </p>
                                  )}
                                  {item.items?.map((labeledItem, idx) => (
                                    <p key={idx} className="text-base text-[#1A1A1A]">
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
                          <div className="mb-4 overflow-hidden bg-[#F5F0E8] border border-[#1A1A1A]">
                            <img
                              src={currentQuestion.imageUrl}
                              alt="문제 이미지"
                              className="w-full h-auto object-contain max-h-48"
                            />
                          </div>
                        )}

                        {/* 보기 (<보기> 박스) */}
                        {currentQuestion.bogi && currentQuestion.bogi.items && currentQuestion.bogi.items.some(i => i.content?.trim()) && (
                          <div className="mb-4 p-4 bg-[#F5F0E8] border-2 border-[#1A1A1A]">
                            <p className="text-sm text-center text-[#5C5C5C] mb-3 font-bold">&lt;보 기&gt;</p>
                            <div className="space-y-2">
                              {currentQuestion.bogi.items.filter(i => i.content?.trim()).map((item) => (
                                <p key={item.label} className="text-base text-[#1A1A1A]">
                                  <span className="font-bold mr-1">{item.label}.</span>
                                  {item.content}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 발문 (제시문 발문 + 보기 발문) */}
                        {(currentQuestion.passagePrompt || currentQuestion.bogi?.questionText) && (
                          <p className="mb-4 text-base text-[#1A1A1A]">
                            {currentQuestion.passagePrompt && currentQuestion.bogi?.questionText
                              ? `${currentQuestion.passagePrompt} ${currentQuestion.bogi.questionText}`
                              : currentQuestion.passagePrompt || currentQuestion.bogi?.questionText}
                          </p>
                        )}

                        {/* OX 선지 - 퀴즈 풀이와 동일한 스타일, 오답은 그래프 채움 */}
                        {currentQuestion.questionType === 'ox' && (() => {
                          const oCount = currentQuestion.oxDistribution?.o || 0;
                          const xCount = currentQuestion.oxDistribution?.x || 0;
                          const totalSelections = oCount + xCount;

                          // 정답 확인
                          const correctAnswer = currentQuestion.correctAnswer?.toUpperCase() === 'O' ||
                            currentQuestion.correctAnswer === '0' ? 'O' : 'X';

                          const oPercentage = totalSelections > 0 ? Math.round((oCount / totalSelections) * 100) : 0;
                          const xPercentage = totalSelections > 0 ? Math.round((xCount / totalSelections) * 100) : 0;

                          return (
                            <div className="flex gap-4 justify-center py-3 mb-4">
                              {['O', 'X'].map((opt) => {
                                const isCorrect = opt === correctAnswer;
                                const percentage = opt === 'O' ? oPercentage : xPercentage;

                                // 정답 선지
                                if (isCorrect) {
                                  return (
                                    <div
                                      key={opt}
                                      className="w-24 h-24 text-4xl font-bold border-2 flex flex-col items-center justify-center bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A]"
                                    >
                                      <span>{opt}</span>
                                      <span className="text-sm font-normal mt-1">{percentage}%</span>
                                    </div>
                                  );
                                }

                                // 오답 선지 - 선택률만큼 아래에서 위로 그래프 채움
                                return (
                                  <div
                                    key={opt}
                                    className="relative w-24 h-24 text-4xl font-bold border-2 border-[#8B1A1A] flex flex-col items-center justify-center overflow-hidden"
                                    style={{ backgroundColor: '#EDEAE4' }}
                                  >
                                    {/* 선택률 배경 그래프 (아래에서 위로) */}
                                    {percentage > 0 && (
                                      <motion.div
                                        initial={{ height: 0 }}
                                        animate={{ height: `${percentage}%` }}
                                        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                                        className="absolute left-0 right-0 bottom-0 bg-[#FDEAEA]"
                                      />
                                    )}
                                    <span className="relative z-10 text-[#8B1A1A]">{opt}</span>
                                    <span className="relative z-10 text-sm font-normal mt-1 text-[#8B1A1A]">{percentage}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 객관식 선지 - 정답은 초록 배경, 오답은 선택률만큼 빨강 그래프 채움 */}
                        {currentQuestion.questionType === 'multiple' && currentQuestion.optionDistribution && (() => {
                          // 오답 선지들 중 가장 높은 선택률 찾기
                          const wrongOptions = currentQuestion.optionDistribution.filter(o => !o.isCorrect);
                          const maxWrongPercentage = wrongOptions.length > 0
                            ? Math.max(...wrongOptions.map(o => o.percentage))
                            : 0;

                          return (
                            <div className="space-y-2 mb-4">
                              {currentQuestion.optionDistribution.map((opt, optIdx) => {
                                // 오답 중에서 선택률이 가장 높은 경우 빨간 테두리
                                const isHighestWrong = !opt.isCorrect && opt.percentage === maxWrongPercentage && maxWrongPercentage > 0;

                                // 정답 선지
                                if (opt.isCorrect) {
                                  return (
                                    <div
                                      key={optIdx}
                                      className="flex items-center gap-3 p-3 border-2 bg-[#E8F5E9] border-[#1A6B1A]"
                                    >
                                      <span className="text-base font-bold min-w-[24px] text-[#1A6B1A]">
                                        {optIdx + 1}.
                                      </span>
                                      <span className="flex-1 text-base text-[#1A1A1A]">{opt.option}</span>
                                      <span className="text-base font-bold text-[#1A6B1A]">
                                        {opt.percentage}%
                                      </span>
                                    </div>
                                  );
                                }

                                // 오답 선지 - 선택률만큼 배경 그래프 채움
                                return (
                                  <div
                                    key={optIdx}
                                    className={`relative flex items-center gap-3 p-3 border-2 overflow-hidden ${
                                      isHighestWrong ? 'border-[#8B1A1A]' : 'border-[#D4CFC4]'
                                    }`}
                                    style={{ backgroundColor: '#F5F0E8' }}
                                  >
                                    {/* 선택률 배경 그래프 */}
                                    {opt.percentage > 0 && (
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${opt.percentage}%` }}
                                        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 + optIdx * 0.05 }}
                                        className="absolute left-0 top-0 bottom-0 bg-[#FDEAEA]"
                                      />
                                    )}
                                    {/* 콘텐츠 */}
                                    <span className={`relative z-10 text-base font-bold min-w-[24px] ${isHighestWrong ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'}`}>
                                      {optIdx + 1}.
                                    </span>
                                    <span className="relative z-10 flex-1 text-base text-[#1A1A1A]">{opt.option}</span>
                                    <span className={`relative z-10 text-base font-bold ${isHighestWrong ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'}`}>
                                      {opt.percentage}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 주관식 - 정답과 오답 표시 */}
                        {(currentQuestion.questionType === 'short_answer' || currentQuestion.questionType === 'short') && (
                          <div className="space-y-3">
                            <div className="p-3 bg-[#E8F5E9] border-2 border-[#1A6B1A]">
                              <span className="text-base text-[#1A6B1A] font-bold">정답: </span>
                              <span className="text-base text-[#1A6B1A]">
                                {currentQuestion.correctAnswer?.includes('|||')
                                  ? currentQuestion.correctAnswer.split('|||').map(a => a.trim()).join(', ')
                                  : currentQuestion.correctAnswer || '-'}
                              </span>
                            </div>
                            {currentQuestion.wrongAnswers && currentQuestion.wrongAnswers.length > 0 && (
                              <div className="p-3 bg-[#FDEAEA] border-2 border-[#8B1A1A]">
                                <span className="text-base text-[#8B1A1A] font-bold">오답: </span>
                                <span className="text-base text-[#8B1A1A]">
                                  {currentQuestion.wrongAnswers.slice(0, 5).map(w => w.answer).join(', ')}
                                  {currentQuestion.wrongAnswers.length > 5 && ` 외 ${currentQuestion.wrongAnswers.length - 5}개`}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                      </motion.div>
                      </AnimatePresence>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
