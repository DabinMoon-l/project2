'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useExpToast } from '@/components/common';
import { useUser } from '@/lib/contexts';

/**
 * 피드백 타입
 */
type FeedbackType = 'unclear' | 'wrong' | 'typo' | 'other';

/**
 * 피드백 타입 옵션
 */
const FEEDBACK_TYPE_OPTIONS: { type: FeedbackType; label: string }[] = [
  { type: 'unclear', label: '문제가 이해가 안 돼요' },
  { type: 'wrong', label: '정답이 틀린 것 같아요' },
  { type: 'typo', label: '오타가 있어요' },
  { type: 'other', label: '기타 의견' },
];

/**
 * 문제 결과 타입
 */
interface QuestionResult {
  id: string;
  number: number;
  question: string;
  type: 'ox' | 'multiple' | 'short';
  options?: string[];
  correctAnswer: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation?: string;
  // 결합형 문제 관련
  combinedGroupId?: string;
  subQuestionIndex?: number;
}

/**
 * 결합형 문제 그룹 타입
 */
interface CombinedGroup {
  groupId: string;
  groupNumber: number;
  commonQuestion?: string;
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  subQuestions: QuestionResult[];
}

/**
 * 페이지 아이템 타입 (일반 문제 또는 결합형 그룹)
 */
type PageItem =
  | { type: 'single'; question: QuestionResult }
  | { type: 'combined'; group: CombinedGroup };

/**
 * 피드백 페이지 데이터 타입
 */
interface FeedbackPageData {
  quizId: string;
  quizTitle: string;
  quizCreatorId: string;
  questionResults: QuestionResult[];
  pageItems: PageItem[]; // 페이지 단위 아이템 (일반 문제 또는 결합형 그룹)
  hasSubmittedFeedback: boolean;
}

/**
 * 스와이프 방향 감지 임계값
 */
const SWIPE_THRESHOLD = 50;

/**
 * 일반 문제 카드 props
 */
interface SingleQuestionCardProps {
  question: QuestionResult;
  feedbackTypes: Record<string, FeedbackType | null>;
  feedbacks: Record<string, string>;
  onFeedbackTypeChange: (questionId: string, type: FeedbackType) => void;
  onFeedbackChange: (questionId: string, value: string) => void;
}

/**
 * 일반 문제 카드 컴포넌트
 */
function SingleQuestionCard({
  question,
  feedbackTypes,
  feedbacks,
  onFeedbackTypeChange,
  onFeedbackChange,
}: SingleQuestionCardProps) {
  return (
    <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4">
      {/* 정답/오답 표시 */}
      <div className={`inline-block px-3 py-1 text-xs font-bold mb-3 ${
        question.isCorrect
          ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
          : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
      }`}>
        {question.isCorrect ? '정답' : '오답'}
      </div>

      {/* 문제 */}
      <div className="mb-4">
        <p className="text-xs text-[#5C5C5C] mb-1">Q{question.number}</p>
        <p className="text-sm font-bold text-[#1A1A1A] leading-relaxed">
          {question.question}
        </p>
      </div>

      {/* 선지 (객관식) */}
      {question.type === 'multiple' && question.options && question.options.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-bold text-[#5C5C5C]">선지</p>
          {question.options.map((option, idx) => {
            const optionNum = (idx + 1).toString();
            const correctAnswerStr = question.correctAnswer?.toString() || '';
            const userAnswerStr = question.userAnswer?.toString() || '';

            const isCorrect = correctAnswerStr.includes(',')
              ? correctAnswerStr.split(',').map(s => s.trim()).includes(optionNum)
              : correctAnswerStr === optionNum;

            const isUserAnswer = userAnswerStr.includes(',')
              ? userAnswerStr.split(',').map(s => s.trim()).includes(optionNum)
              : userAnswerStr === optionNum;

            return (
              <div
                key={idx}
                className={`p-2 text-xs border ${
                  isCorrect
                    ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A]'
                    : isUserAnswer
                    ? 'bg-[#FFEBEE] border-[#8B1A1A] text-[#8B1A1A]'
                    : 'bg-[#EDEAE4] border-[#EDEAE4] text-[#5C5C5C]'
                }`}
              >
                <span className="font-bold mr-2">{idx + 1}.</span>
                {option}
                {isCorrect && isUserAnswer && <span className="ml-2 font-bold">(정답)</span>}
                {isCorrect && !isUserAnswer && <span className="ml-2 font-bold">(정답)</span>}
                {!isCorrect && isUserAnswer && <span className="ml-2 font-bold">(내 선택)</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* OX 또는 주관식 답변 */}
      {(question.type === 'ox' || question.type === 'short') && (
        <div className="mb-4 space-y-2">
          {question.type === 'short' && question.correctAnswer?.includes('|||') ? (
            <div className="space-y-2 text-xs">
              <div className="p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                <span className="text-[#5C5C5C]">정답: </span>
                <span className="font-bold text-[#1A6B1A]">
                  {question.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')}
                </span>
              </div>
              <div className={`p-2 ${
                question.isCorrect
                  ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                  : 'bg-[#FFEBEE] border border-[#8B1A1A]'
              }`}>
                <span className="text-[#5C5C5C]">내 답: </span>
                <span className={`font-bold ${
                  question.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                }`}>
                  {question.userAnswer || '(미입력)'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex gap-4 text-xs">
              <div className="flex-1 p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                <span className="text-[#5C5C5C]">정답: </span>
                <span className="font-bold text-[#1A6B1A]">{question.correctAnswer}</span>
              </div>
              <div className={`flex-1 p-2 ${
                question.isCorrect
                  ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                  : 'bg-[#FFEBEE] border border-[#8B1A1A]'
              }`}>
                <span className="text-[#5C5C5C]">내 답: </span>
                <span className={`font-bold ${
                  question.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                }`}>
                  {question.userAnswer || '(미입력)'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 해설 */}
      {question.explanation && (
        <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
          <p className="text-xs font-bold text-[#1A1A1A] mb-1">해설</p>
          <p className="text-xs text-[#5C5C5C] leading-relaxed">
            {question.explanation}
          </p>
        </div>
      )}

      {/* 피드백 타입 선택 */}
      <div className="mt-4">
        <label className="text-xs font-bold text-[#1A1A1A] mb-2 block">
          이 문제에 대한 피드백 (선택)
        </label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {FEEDBACK_TYPE_OPTIONS.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              onClick={() => onFeedbackTypeChange(question.id, type)}
              className={`p-2 text-xs font-bold border-2 transition-colors ${
                feedbackTypes[question.id] === type
                  ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                  : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {feedbackTypes[question.id] && (
          <div className="mt-2">
            <label className="text-xs text-[#5C5C5C] mb-1 block">
              추가 의견 (선택)
            </label>
            <textarea
              value={feedbacks[question.id] || ''}
              onChange={(e) => onFeedbackChange(question.id, e.target.value)}
              placeholder="자세한 내용을 적어주세요..."
              className="w-full px-3 py-2 text-sm bg-white border-2 border-[#1A1A1A] placeholder:text-[#AAAAAA] focus:outline-none resize-none"
              rows={2}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 결합형 문제 그룹 카드 props
 */
interface CombinedQuestionCardProps {
  group: CombinedGroup;
  feedbackTypes: Record<string, FeedbackType | null>;
  feedbacks: Record<string, string>;
  onFeedbackTypeChange: (questionId: string, type: FeedbackType) => void;
  onFeedbackChange: (questionId: string, value: string) => void;
}

/**
 * 결합형 문제 그룹 카드 컴포넌트
 */
function CombinedQuestionCard({
  group,
  feedbackTypes,
  feedbacks,
  onFeedbackTypeChange,
  onFeedbackChange,
}: CombinedQuestionCardProps) {
  // 정답/오답 카운트
  const correctCount = group.subQuestions.filter(q => q.isCorrect).length;
  const totalCount = group.subQuestions.length;

  return (
    <div className="space-y-4">
      {/* 결합형 문제 헤더 */}
      <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4">
        {/* 문제 번호 및 유형 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg font-bold text-[#1A1A1A]">
            Q{group.groupNumber}.
          </span>
          <span className="px-2 py-0.5 bg-[#8B6914] text-[#F5F0E8] text-xs font-bold">
            결합형
          </span>
          <span className="text-xs text-[#5C5C5C]">
            ({totalCount}문제 중 {correctCount}개 정답)
          </span>
        </div>

        {/* 공통 문제 */}
        {group.commonQuestion && (
          <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap mb-4">
            {group.commonQuestion}
          </p>
        )}

        {/* 공통 지문 - 텍스트 형식 */}
        {group.passage && (!group.passageType || group.passageType === 'text') && (
          <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] mb-4">
            <p className="text-[#1A1A1A] text-xs leading-relaxed whitespace-pre-wrap">
              {group.passage}
            </p>
          </div>
        )}

        {/* 공통 지문 - ㄱㄴㄷ 형식 */}
        {group.passageType === 'korean_abc' && group.koreanAbcItems && group.koreanAbcItems.length > 0 && (
          <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A] mb-4 space-y-1">
            <p className="text-xs text-[#5C5C5C] mb-2 font-bold">보기</p>
            {group.koreanAbcItems.filter((i: string) => i.trim()).map((item: string, idx: number) => (
              <p key={idx} className="text-[#1A1A1A] text-xs">
                <span className="font-bold text-[#1A1A1A] mr-1">
                  {['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.
                </span>
                {item}
              </p>
            ))}
          </div>
        )}

        {/* 공통 이미지 */}
        {group.passageImage && (
          <div className="relative w-full aspect-video overflow-hidden bg-[#EDEAE4] border border-[#1A1A1A]">
            <p className="absolute top-2 left-2 text-xs text-[#5C5C5C] font-bold bg-[#EDEAE4]/80 px-2 py-0.5 z-10">
              공통 이미지
            </p>
            <img
              src={group.passageImage}
              alt="공통 이미지"
              className="w-full h-full object-contain"
            />
          </div>
        )}
      </div>

      {/* 하위 문제들 */}
      {group.subQuestions.map((question, idx) => {
        const subNumber = `${group.groupNumber}-${idx + 1}`;

        return (
          <div
            key={question.id}
            className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4"
          >
            {/* 정답/오답 및 문제 번호 */}
            <div className="flex items-center gap-2 mb-3">
              <div className={`px-2 py-0.5 text-xs font-bold ${
                question.isCorrect
                  ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                  : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
              }`}>
                {question.isCorrect ? '정답' : '오답'}
              </div>
              <span className="text-sm font-bold text-[#1A1A1A]">
                Q{subNumber}.
              </span>
              <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                {question.type === 'ox' ? 'OX' :
                 question.type === 'multiple' ? '객관식' :
                 question.type === 'short' ? '단답형' :
                 question.type}
              </span>
            </div>

            {/* 하위 문제 텍스트 */}
            <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap mb-4">
              {question.question}
            </p>

            {/* 선지 (객관식) */}
            {question.type === 'multiple' && question.options && question.options.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="text-xs font-bold text-[#5C5C5C]">선지</p>
                {question.options.map((option, optIdx) => {
                  const optionNum = (optIdx + 1).toString();
                  const correctAnswerStr = question.correctAnswer?.toString() || '';
                  const userAnswerStr = question.userAnswer?.toString() || '';

                  const isCorrect = correctAnswerStr.includes(',')
                    ? correctAnswerStr.split(',').map(s => s.trim()).includes(optionNum)
                    : correctAnswerStr === optionNum;

                  const isUserAnswer = userAnswerStr.includes(',')
                    ? userAnswerStr.split(',').map(s => s.trim()).includes(optionNum)
                    : userAnswerStr === optionNum;

                  return (
                    <div
                      key={optIdx}
                      className={`p-2 text-xs border ${
                        isCorrect
                          ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A]'
                          : isUserAnswer
                          ? 'bg-[#FFEBEE] border-[#8B1A1A] text-[#8B1A1A]'
                          : 'bg-[#EDEAE4] border-[#EDEAE4] text-[#5C5C5C]'
                      }`}
                    >
                      <span className="font-bold mr-2">{optIdx + 1}.</span>
                      {option}
                      {isCorrect && isUserAnswer && <span className="ml-2 font-bold">(정답)</span>}
                      {isCorrect && !isUserAnswer && <span className="ml-2 font-bold">(정답)</span>}
                      {!isCorrect && isUserAnswer && <span className="ml-2 font-bold">(내 선택)</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* OX 또는 주관식 답변 */}
            {(question.type === 'ox' || question.type === 'short') && (
              <div className="mb-4 space-y-2">
                {question.type === 'short' && question.correctAnswer?.includes('|||') ? (
                  <div className="space-y-2 text-xs">
                    <div className="p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                      <span className="text-[#5C5C5C]">정답: </span>
                      <span className="font-bold text-[#1A6B1A]">
                        {question.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')}
                      </span>
                    </div>
                    <div className={`p-2 ${
                      question.isCorrect
                        ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                        : 'bg-[#FFEBEE] border border-[#8B1A1A]'
                    }`}>
                      <span className="text-[#5C5C5C]">내 답: </span>
                      <span className={`font-bold ${
                        question.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                      }`}>
                        {question.userAnswer || '(미입력)'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-4 text-xs">
                    <div className="flex-1 p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                      <span className="text-[#5C5C5C]">정답: </span>
                      <span className="font-bold text-[#1A6B1A]">{question.correctAnswer}</span>
                    </div>
                    <div className={`flex-1 p-2 ${
                      question.isCorrect
                        ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                        : 'bg-[#FFEBEE] border border-[#8B1A1A]'
                    }`}>
                      <span className="text-[#5C5C5C]">내 답: </span>
                      <span className={`font-bold ${
                        question.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                      }`}>
                        {question.userAnswer || '(미입력)'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 해설 */}
            {question.explanation && (
              <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                <p className="text-xs font-bold text-[#1A1A1A] mb-1">해설</p>
                <p className="text-xs text-[#5C5C5C] leading-relaxed">
                  {question.explanation}
                </p>
              </div>
            )}

            {/* 피드백 타입 선택 */}
            <div className="mt-4">
              <label className="text-xs font-bold text-[#1A1A1A] mb-2 block">
                Q{subNumber}에 대한 피드백 (선택)
              </label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {FEEDBACK_TYPE_OPTIONS.map(({ type, label }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onFeedbackTypeChange(question.id, type)}
                    className={`p-2 text-xs font-bold border-2 transition-colors ${
                      feedbackTypes[question.id] === type
                        ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                        : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {feedbackTypes[question.id] && (
                <div className="mt-2">
                  <label className="text-xs text-[#5C5C5C] mb-1 block">
                    추가 의견 (선택)
                  </label>
                  <textarea
                    value={feedbacks[question.id] || ''}
                    onChange={(e) => onFeedbackChange(question.id, e.target.value)}
                    placeholder="자세한 내용을 적어주세요..."
                    className="w-full px-3 py-2 text-sm bg-white border-2 border-[#1A1A1A] placeholder:text-[#AAAAAA] focus:outline-none resize-none"
                    rows={2}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 피드백 페이지
 *
 * 퀴즈의 각 문제에 대해 스와이프로 넘기며 피드백을 입력합니다.
 */
export default function FeedbackPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();

  const quizId = params.id as string;

  // 상태
  const [pageData, setPageData] = useState<FeedbackPageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [feedbackTypes, setFeedbackTypes] = useState<Record<string, FeedbackType | null>>({});
  const [direction, setDirection] = useState(0);

  // 터치 참조
  const containerRef = useRef<HTMLDivElement>(null);

  // 마운트 상태 추적 (Firebase 오류 방지)
  const isMountedRef = useRef(true);

  // 마운트 상태 cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * 퀴즈 데이터 및 사용자 답변 로드
   */
  const loadQuizData = useCallback(async () => {
    if (!user || !quizId) return;

    try {
      setIsLoading(true);

      // 퀴즈 데이터 가져오기
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) {
        setError('퀴즈를 찾을 수 없습니다.');
        return;
      }

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];

      // 사용자 결과 문서 확인
      const resultsQuery = query(
        collection(db, 'quizResults'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const resultsSnapshot = await getDocs(resultsQuery);

      let hasSubmittedFeedback = false;
      let userAnswers: string[] = [];

      if (!resultsSnapshot.empty) {
        const resultData = resultsSnapshot.docs[0].data();
        hasSubmittedFeedback = resultData.hasFeedback || false;
        userAnswers = resultData.answers || [];
      }

      // 로컬 스토리지에서 결과 데이터 가져오기 (결과 페이지에서 저장한 것)
      const storedResult = localStorage.getItem(`quiz_result_${quizId}`);
      if (storedResult) {
        try {
          const resultJson = JSON.parse(storedResult);
          if (resultJson.questionResults && resultJson.questionResults.length > 0) {
            // 결과 데이터에서 userAnswer 추출
            userAnswers = resultJson.questionResults.map((r: any) => r.userAnswer || '');
          }
        } catch (e) {
          console.error('결과 데이터 파싱 오류:', e);
        }
      }

      // 로컬 스토리지에서 답변 가져오기 (fallback)
      if (userAnswers.length === 0) {
        const storedAnswers = localStorage.getItem(`quiz_answers_${quizId}`);
        if (storedAnswers) {
          userAnswers = JSON.parse(storedAnswers);
        }
      }

      // 문제별 결과 생성
      const questionResults: QuestionResult[] = questions.map(
        (q: any, index: number) => {
          const userAnswer = userAnswers[index] || '';
          const correctAnswer = q.correctAnswer ?? q.answer ?? '';

          // 정답 여부 계산 (result/page.tsx와 동일한 로직)
          let isCorrect = false;
          if (q.type === 'multiple') {
            const correctAnswerStr = correctAnswer.toString();
            const userAnswerStr = userAnswer.toString();

            // 복수정답 여부 확인
            if (correctAnswerStr.includes(',')) {
              // 복수정답: 모든 정답을 선택해야 정답
              const correctIndices = correctAnswerStr.split(',').map((s: string) => parseInt(s.trim(), 10));
              const userIndices = userAnswerStr
                ? userAnswerStr.split(',').map((s: string) => parseInt(s.trim(), 10))
                : [];

              const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
              const sortedUser = [...userIndices].sort((a, b) => a - b);

              isCorrect =
                sortedCorrect.length === sortedUser.length &&
                sortedCorrect.every((val, idx) => val === sortedUser[idx]);
            } else {
              // 단일정답
              isCorrect = userAnswerStr === correctAnswerStr;
            }
          } else if (q.type === 'ox') {
            // OX: 정답이 "0"/"1" 또는 "O"/"X"일 수 있음
            const userOX = userAnswer.toString().toUpperCase();
            let correctOX = correctAnswer.toString().toUpperCase();
            if (correctOX === '0') correctOX = 'O';
            else if (correctOX === '1') correctOX = 'X';
            isCorrect = userOX === correctOX;
          } else {
            // 주관식: 복수 정답 지원 ("|||"로 구분)
            const userAnswerNormalized = userAnswer.toString().trim().toLowerCase();
            if (correctAnswer.toString().includes('|||')) {
              const correctAnswers = correctAnswer.toString().split('|||').map((a: string) => a.trim().toLowerCase());
              isCorrect = correctAnswers.some((ca: string) => userAnswerNormalized === ca);
            } else {
              isCorrect = userAnswerNormalized === correctAnswer.toString().trim().toLowerCase();
            }
          }

          // OX 타입의 경우 표시용 값 변환
          let displayCorrectAnswer = correctAnswer;
          let displayUserAnswer = userAnswer;
          if (q.type === 'ox') {
            // 정답 표시 변환
            if (correctAnswer === '0' || correctAnswer === 0) displayCorrectAnswer = 'O';
            else if (correctAnswer === '1' || correctAnswer === 1) displayCorrectAnswer = 'X';
            // 사용자 답변은 이미 O/X로 저장됨
          }

          return {
            id: q.id || `q${index}`,
            number: index + 1,
            question: q.question || q.text || '',
            type: q.type || 'short',
            options: q.options || q.choices || [],
            correctAnswer: displayCorrectAnswer,
            userAnswer: displayUserAnswer,
            isCorrect,
            explanation: q.explanation || '',
            combinedGroupId: q.combinedGroupId,
            subQuestionIndex: q.subQuestionIndex,
          };
        }
      );

      // 페이지 아이템 생성 (결합형 문제 그룹화)
      const pageItems: PageItem[] = [];
      const processedGroupIds = new Set<string>();
      let displayNumber = 1;

      questions.forEach((q: any, index: number) => {
        const result = questionResults[index];

        if (q.combinedGroupId) {
          // 결합형 문제
          if (!processedGroupIds.has(q.combinedGroupId)) {
            processedGroupIds.add(q.combinedGroupId);

            // 같은 그룹의 모든 하위 문제 찾기
            const groupQuestions = questions
              .map((gq: any, gIdx: number) => ({ q: gq, idx: gIdx }))
              .filter((item: any) => item.q.combinedGroupId === q.combinedGroupId);

            const subQuestions = groupQuestions.map((item: any, subIdx: number) => ({
              ...questionResults[item.idx],
              subQuestionIndex: subIdx,
            }));

            const group: CombinedGroup = {
              groupId: q.combinedGroupId,
              groupNumber: displayNumber,
              commonQuestion: q.commonQuestion,
              passage: q.passage,
              passageType: q.passageType,
              passageImage: q.passageImage,
              koreanAbcItems: q.koreanAbcItems,
              subQuestions,
            };

            pageItems.push({ type: 'combined', group });
            displayNumber++;
          }
        } else {
          // 일반 문제
          pageItems.push({
            type: 'single',
            question: { ...result, number: displayNumber },
          });
          displayNumber++;
        }
      });

      // 피드백 초기화
      const initialFeedbacks: Record<string, string> = {};
      const initialFeedbackTypes: Record<string, FeedbackType | null> = {};
      questionResults.forEach((q) => {
        initialFeedbacks[q.id] = '';
        initialFeedbackTypes[q.id] = null;
      });
      setFeedbacks(initialFeedbacks);
      setFeedbackTypes(initialFeedbackTypes);

      setPageData({
        quizId,
        quizTitle: quizData.title || '퀴즈',
        quizCreatorId: quizData.creatorId || '',
        questionResults,
        pageItems,
        hasSubmittedFeedback,
      });
    } catch (err) {
      console.error('피드백 페이지 로드 오류:', err);
      setError('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [user, quizId]);

  // 데이터 로드
  useEffect(() => {
    loadQuizData();
  }, [loadQuizData]);

  /**
   * 다음 페이지로 이동
   */
  const goToNext = useCallback(() => {
    if (pageData && currentIndex < pageData.pageItems.length - 1) {
      setDirection(1);
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, pageData]);

  /**
   * 이전 문제로 이동
   */
  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  /**
   * 스와이프 핸들러
   */
  const handleDragEnd = (event: any, info: PanInfo) => {
    if (info.offset.x > SWIPE_THRESHOLD) {
      goToPrev();
    } else if (info.offset.x < -SWIPE_THRESHOLD) {
      goToNext();
    }
  };

  /**
   * 피드백 변경 핸들러
   */
  const handleFeedbackChange = (questionId: string, value: string) => {
    setFeedbacks((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  };

  /**
   * 피드백 타입 선택 핸들러
   */
  const handleFeedbackTypeChange = (questionId: string, type: FeedbackType) => {
    setFeedbackTypes((prev) => ({
      ...prev,
      [questionId]: prev[questionId] === type ? null : type, // 토글
    }));
  };

  /**
   * 피드백 제출 핸들러
   */
  const handleSubmit = async () => {
    if (!user || !pageData) return;

    try {
      setIsSubmitting(true);

      // 피드백 저장 (타입이 선택된 경우만)
      const feedbackEntries = Object.entries(feedbackTypes).filter(([_, type]) => type !== null);
      console.log('[피드백] 저장할 피드백 수:', feedbackEntries.length);

      for (const [questionId, feedbackType] of feedbackEntries) {
        if (!isMountedRef.current) return; // 마운트 상태 체크
        if (feedbackType) {
          const feedback = feedbacks[questionId] || '';
          console.log('[피드백] 저장 중:', { questionId, feedbackType, feedback: feedback.trim() });
          try {
            await addDoc(collection(db, 'feedbacks'), {
              userId: user.uid,
              quizId: pageData.quizId,
              quizCreatorId: pageData.quizCreatorId, // 퀴즈 제작자 ID 추가
              questionId,
              feedbackType,
              feedback: feedback.trim(),
              createdAt: serverTimestamp(),
            });
            console.log('[피드백] 저장 성공:', questionId);
          } catch (feedbackErr) {
            console.error('[피드백] 저장 실패:', questionId, feedbackErr);
            throw feedbackErr; // 에러를 다시 throw해서 상위 catch에서 처리
          }
        }
      }

      if (!isMountedRef.current) return; // 마운트 상태 체크

      // 사용자 결과 문서 업데이트 (피드백 완료 표시)
      const resultsQuery = query(
        collection(db, 'quizResults'),
        where('userId', '==', user.uid),
        where('quizId', '==', pageData.quizId)
      );
      const resultsSnapshot = await getDocs(resultsQuery);

      if (!isMountedRef.current) return; // 마운트 상태 체크

      if (!resultsSnapshot.empty) {
        const resultDocRef = resultsSnapshot.docs[0].ref;
        await updateDoc(resultDocRef, {
          hasFeedback: true,
          feedbackAt: serverTimestamp(),
        });
      }

      // 피드백 제출 여부를 localStorage에 저장 (EXP 페이지에서 확인)
      const feedbackCount = Object.values(feedbackTypes).filter((t) => t !== null).length;
      if (feedbackCount > 0) {
        localStorage.setItem(`quiz_feedback_${quizId}`, 'true');
      }

      if (!isMountedRef.current) return; // 마운트 상태 체크

      // EXP 페이지로 이동 (EXP 토스트는 EXP 페이지에서 표시)
      router.push(`/quiz/${quizId}/exp`);
    } catch (err) {
      console.error('피드백 제출 오류:', err);
      setError('피드백 제출 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 건너뛰기 핸들러
   */
  const handleSkip = () => {
    // EXP 페이지로 이동 (피드백 미제출)
    router.push(`/quiz/${quizId}/exp`);
  };

  // 로딩 UI
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#1A1A1A] border-t-transparent animate-spin" />
          <p className="text-[#5C5C5C] text-sm">로딩 중...</p>
        </div>
      </div>
    );
  }

  // 에러 UI
  if (error || !pageData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">오류 발생</h2>
        <p className="text-[#5C5C5C] text-center mb-6">{error || '알 수 없는 오류가 발생했습니다.'}</p>
        <button
          onClick={() => router.push('/quiz')}
          className="px-6 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold"
        >
          퀴즈 목록으로
        </button>
      </div>
    );
  }

  // 자신이 만든 퀴즈인 경우
  if (user && pageData.quizCreatorId === user.uid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
          피드백을 남길 수 없습니다
        </h2>
        <p className="text-[#5C5C5C] text-center mb-6">
          자신이 만든 퀴즈에는 피드백을 남길 수 없습니다.
        </p>
        <button
          onClick={() => router.push('/quiz')}
          className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold"
        >
          퀴즈 목록으로
        </button>
      </div>
    );
  }

  // 이미 피드백을 제출한 경우
  if (pageData.hasSubmittedFeedback) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
          이미 피드백을 제출했습니다
        </h2>
        <p className="text-[#5C5C5C] text-center mb-6">
          소중한 의견 감사합니다!
        </p>
        <button
          onClick={() => router.push('/quiz')}
          className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold"
        >
          퀴즈 목록으로
        </button>
      </div>
    );
  }

  const currentPageItem = pageData.pageItems[currentIndex];
  const totalPages = pageData.pageItems.length;

  // 슬라이드 애니메이션 variants
  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 300 : -300,
      opacity: 0,
    }),
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-50 px-4 py-4 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
        <div className="flex items-center justify-between">
          {/* 뒤로가기 버튼 - 결과 페이지로 이동 */}
          <button
            onClick={() => {
              router.push(`/quiz/${quizId}/result`);
            }}
            className="p-2 -ml-2 text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            aria-label="결과 페이지로"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-center">
            <h1 className="text-lg font-bold text-[#1A1A1A]">
              피드백
            </h1>
            <p className="text-xs text-[#5C5C5C] mt-0.5">
              문제에 대한 의견을 남겨주세요
            </p>
          </div>
          <div className="w-10" /> {/* 버튼 균형용 */}
        </div>
      </header>

      {/* 진행 상태 표시 */}
      <div className="px-4 py-3 border-b border-[#EDEAE4]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold text-[#1A1A1A]">
            {currentIndex + 1} / {totalPages}
          </span>
          <span className="text-xs text-[#5C5C5C]">
            좌우로 스와이프하여 이동
          </span>
        </div>
        {/* 진행 바 */}
        <div className="h-1 bg-[#EDEAE4]">
          <motion.div
            className="h-full bg-[#1A1A1A]"
            initial={{ width: 0 }}
            animate={{ width: `${((currentIndex + 1) / totalPages) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        {/* 페이지 인디케이터 */}
        <div className="flex justify-center gap-1 mt-3">
          {pageData.pageItems.map((_, idx) => (
            <button
              key={idx}
              onClick={() => {
                setDirection(idx > currentIndex ? 1 : -1);
                setCurrentIndex(idx);
              }}
              className={`w-2 h-2 transition-colors ${
                idx === currentIndex ? 'bg-[#1A1A1A]' : 'bg-[#EDEAE4]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 문제 카드 영역 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
      >
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            className="absolute inset-0 p-4 overflow-y-auto"
          >
            {currentPageItem.type === 'single' ? (
              // 일반 문제
              <SingleQuestionCard
                question={currentPageItem.question}
                feedbackTypes={feedbackTypes}
                feedbacks={feedbacks}
                onFeedbackTypeChange={handleFeedbackTypeChange}
                onFeedbackChange={handleFeedbackChange}
              />
            ) : (
              // 결합형 문제 그룹
              <CombinedQuestionCard
                group={currentPageItem.group}
                feedbackTypes={feedbackTypes}
                feedbacks={feedbacks}
                onFeedbackTypeChange={handleFeedbackTypeChange}
                onFeedbackChange={handleFeedbackChange}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 이전/다음 버튼 */}
      <div className="px-4 py-2 flex justify-between">
        <button
          onClick={goToPrev}
          disabled={currentIndex === 0}
          className={`px-4 py-2 text-sm font-bold border-2 border-[#1A1A1A] ${
            currentIndex === 0
              ? 'opacity-30 cursor-not-allowed text-[#1A1A1A]'
              : 'text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
          } transition-colors`}
        >
          이전
        </button>
        <button
          onClick={goToNext}
          disabled={currentIndex === totalPages - 1}
          className={`px-4 py-2 text-sm font-bold border-2 border-[#1A1A1A] ${
            currentIndex === totalPages - 1
              ? 'opacity-30 cursor-not-allowed text-[#1A1A1A]'
              : 'text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
          } transition-colors`}
        >
          다음
        </button>
      </div>

      {/* 하단 버튼 영역 */}
      <div className="px-4 py-4 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
        <div className="flex gap-3">
          {/* Skip 버튼 */}
          <button
            onClick={handleSkip}
            disabled={isSubmitting}
            className="flex-1 py-3 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50"
          >
            Skip
          </button>

          {/* 완료 버튼 */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-[2] py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-[#F5F0E8] border-t-transparent animate-spin" />
                제출 중...
              </>
            ) : (
              '완료'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
