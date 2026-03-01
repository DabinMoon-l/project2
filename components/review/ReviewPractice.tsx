'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import type { ReviewItem } from '@/lib/hooks/useReview';
import { useReview } from '@/lib/hooks/useReview';
import { getChapterById, formatChapterLabel } from '@/lib/courseIndex';
import OXChoice, { OXAnswer } from '@/components/quiz/OXChoice';
import MultipleChoice from '@/components/quiz/MultipleChoice';
import ShortAnswer from '@/components/quiz/ShortAnswer';
import { BottomSheet, useExpToast } from '@/components/common';
import ExitConfirmModal from '@/components/quiz/ExitConfirmModal';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

/** 피드백 타입 */
type FeedbackType = 'unclear' | 'wrong' | 'typo' | 'other' | 'praise' | 'wantmore';

/** 피드백 유형 옵션 */
const FEEDBACK_TYPES: { type: FeedbackType; label: string; positive?: boolean }[] = [
  { type: 'praise', label: '문제가 좋아요!', positive: true },
  { type: 'wantmore', label: '더 풀고 싶어요', positive: true },
  { type: 'unclear', label: '문제가 이해가 안 돼요' },
  { type: 'wrong', label: '정답이 틀린 것 같아요' },
  { type: 'typo', label: '오타가 있어요' },
  { type: 'other', label: '기타 의견' },
];

interface ReviewPracticeProps {
  /** 복습할 문제 목록 */
  items: ReviewItem[];
  /** 퀴즈 제목 (선택) */
  quizTitle?: string;
  /** 완료 핸들러 */
  onComplete: (results: PracticeResult[]) => void;
  /** 닫기 핸들러 */
  onClose: () => void;
  /** 현재 사용자 ID (본인 문제 피드백 방지용) */
  currentUserId?: string;
  /** 헤더 타이틀 커스터마이징 (기본값: "복습") */
  headerTitle?: string;
  /** 피드백 기능 표시 여부 (기본값: true) */
  showFeedback?: boolean;
}

/**
 * 연습 결과 타입
 */
export interface PracticeResult {
  /** 복습 문제 ID */
  reviewId: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 문제 ID (통계 반영용) */
  questionId: string;
  /** 사용자 답변 */
  userAnswer: string;
  /** 정답 여부 */
  isCorrect: boolean;
}

/** 답안 타입 */
type AnswerType = string | number | number[] | null;

/** 화면 단계 */
type Phase = 'practice' | 'result' | 'feedback';

/**
 * 복습 연습 모드 컴포넌트
 */
// ㄱㄴㄷ 라벨
const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'];

export default function ReviewPractice({
  items,
  quizTitle,
  onComplete,
  onClose,
  currentUserId,
  headerTitle = '복습',
  showFeedback = true,
}: ReviewPracticeProps) {
  // 전체화면 오버레이 body 스크롤 방지
  useEffect(() => {
    lockScroll();
    return () => { unlockScroll(); };
  }, []);

  // 현재 화면 단계
  const [phase, setPhase] = useState<Phase>('practice');
  // 현재 문제 인덱스
  const [currentIndex, setCurrentIndex] = useState(0);
  // 모든 문제의 답안 저장 (인덱스별)
  const [answers, setAnswers] = useState<Record<number, AnswerType>>({});
  // 제출된 문제 인덱스 Set
  const [submittedIndices, setSubmittedIndices] = useState<Set<number>>(new Set());
  // 나가기 확인 모달
  const [showExitModal, setShowExitModal] = useState(false);
  // 결과 저장 (인덱스별) - 단일 문제용
  const [resultsMap, setResultsMap] = useState<Record<number, PracticeResult>>({});
  // 결합형 문제 결과 저장 (그룹 인덱스 -> 하위 인덱스 -> 결과)
  const [combinedResultsMap, setCombinedResultsMap] = useState<Record<number, Record<number, PracticeResult>>>({});
  // 결과 화면에서 펼쳐진 문제 ID Set
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // 결과 화면에서 펼쳐진 결합형 하위 문제 ID Set
  const [expandedSubIds, setExpandedSubIds] = useState<Set<string>>(new Set());
  // 선지별 해설 펼침 상태 (문제인덱스-선지인덱스 조합)
  const [expandedChoiceExplanations, setExpandedChoiceExplanations] = useState<Set<string>>(new Set());

  // 피드백 화면 상태
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // useReview 훅에서 폴더 관련 함수 가져오기
  const { customFolders, createCustomFolder, addToCustomFolder } = useReview();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const { showExpToast } = useExpToast();

  // 피드백 바텀시트 상태
  const [feedbackTargetItem, setFeedbackTargetItem] = useState<ReviewItem | null>(null);
  const [selectedFeedbackType, setSelectedFeedbackType] = useState<FeedbackType | null>(null);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [submittedFeedbackIds, setSubmittedFeedbackIds] = useState<Set<string>>(new Set());
  // 피드백 제출 횟수 (완료 시 합산 EXP 토스트용)
  const [feedbackSubmitCount, setFeedbackSubmitCount] = useState(0);

  // 결합형 문제 그룹화
  const groupedItems = useMemo(() => {
    const groups: Array<{ isCombined: boolean; items: ReviewItem[]; groupId?: string }> = [];
    const combinedGroups = new Map<string, ReviewItem[]>();
    const processedGroupIds = new Set<string>();

    // 먼저 결합형 문제 그룹 생성
    items.forEach(item => {
      if (item.combinedGroupId) {
        if (!combinedGroups.has(item.combinedGroupId)) {
          combinedGroups.set(item.combinedGroupId, []);
        }
        combinedGroups.get(item.combinedGroupId)!.push(item);
      }
    });

    // 결합형 그룹 내 문제들을 combinedIndex 순서로 정렬
    combinedGroups.forEach((groupItems) => {
      groupItems.sort((a, b) => (a.combinedIndex ?? 0) - (b.combinedIndex ?? 0));
    });

    // 원래 순서를 유지하면서 그룹화
    items.forEach(item => {
      if (item.combinedGroupId) {
        if (!processedGroupIds.has(item.combinedGroupId)) {
          processedGroupIds.add(item.combinedGroupId);
          groups.push({
            isCombined: true,
            items: combinedGroups.get(item.combinedGroupId)!,
            groupId: item.combinedGroupId,
          });
        }
      } else {
        groups.push({
          isCombined: false,
          items: [item],
        });
      }
    });

    return groups;
  }, [items]);

  // 현재 그룹
  const currentGroup = groupedItems[currentIndex];
  const totalGroupCount = groupedItems.length;
  const isLastGroup = currentIndex === totalGroupCount - 1;

  // 결합형 문제의 하위 문제별 답안 저장 (groupIndex -> subIndex -> answer)
  const [combinedAnswers, setCombinedAnswers] = useState<Record<number, Record<number, AnswerType>>>({});

  // 현재 문제의 답안 (단일 문제용)
  const answer = answers[currentIndex] ?? null;
  // 현재 문제의 제출 여부
  const isSubmitted = submittedIndices.has(currentIndex);

  // 답안 설정 함수 (단일 문제용)
  const setAnswer = (value: AnswerType) => {
    setAnswers(prev => ({ ...prev, [currentIndex]: value }));
  };

  // 결합형 답안 설정 함수
  const setCombinedAnswer = (subIndex: number, value: AnswerType) => {
    setCombinedAnswers(prev => ({
      ...prev,
      [currentIndex]: {
        ...(prev[currentIndex] || {}),
        [subIndex]: value,
      },
    }));
  };

  // 현재 단일 문제 (결합형이 아닌 경우)
  const currentItem = currentGroup?.isCombined ? null : currentGroup?.items[0];
  const totalCount = totalGroupCount; // 그룹 수로 변경
  const isLastQuestion = isLastGroup;

  // 결과 배열 (모든 문제의 결과 - 결합형 포함)
  const resultsArray = useMemo(() => {
    const results: PracticeResult[] = [];
    groupedItems.forEach((group, groupIdx) => {
      if (group.isCombined) {
        const groupResults = combinedResultsMap[groupIdx] || {};
        group.items.forEach((_, subIdx) => {
          if (groupResults[subIdx]) {
            results.push(groupResults[subIdx]);
          }
        });
      } else {
        if (resultsMap[groupIdx]) {
          results.push(resultsMap[groupIdx]);
        }
      }
    });
    return results;
  }, [groupedItems, resultsMap, combinedResultsMap]);

  // 틀린 문제 목록
  const wrongItems = useMemo(() => {
    const wrongs: ReviewItem[] = [];
    groupedItems.forEach((group, groupIdx) => {
      if (group.isCombined) {
        const groupResults = combinedResultsMap[groupIdx] || {};
        group.items.forEach((item, subIdx) => {
          if (groupResults[subIdx] && !groupResults[subIdx].isCorrect) {
            wrongs.push(item);
          }
        });
      } else {
        if (resultsMap[groupIdx] && !resultsMap[groupIdx].isCorrect) {
          wrongs.push(group.items[0]);
        }
      }
    });
    return wrongs;
  }, [groupedItems, resultsMap, combinedResultsMap]);

  // 틀린 문제를 챕터별로 그룹핑
  const chapterGroupedWrongItems = useMemo(() => {
    const chapterMap = new Map<string | null, ReviewItem[]>();

    wrongItems.forEach(item => {
      let chapterId = item.chapterId || null;

      // 챕터 인덱스에서 찾을 수 없는 chapterId는 미분류(null)로 통합
      if (chapterId && userCourseId) {
        const chapter = getChapterById(userCourseId, chapterId);
        if (!chapter) {
          chapterId = null;
        }
      } else if (chapterId && !userCourseId) {
        chapterId = null;
      }

      const existing = chapterMap.get(chapterId);
      if (existing) {
        existing.push(item);
      } else {
        chapterMap.set(chapterId, [item]);
      }
    });

    const result: Array<{ chapterId: string | null; chapterName: string; items: ReviewItem[] }> = [];

    chapterMap.forEach((items, chapterId) => {
      let chapterName = '미분류';
      if (chapterId && userCourseId) {
        const chapter = getChapterById(userCourseId, chapterId);
        if (chapter) {
          chapterName = chapter.name;
        }
      }
      result.push({ chapterId, chapterName, items });
    });

    // 챕터 순서대로 정렬 (미분류는 마지막)
    return result.sort((a, b) => {
      if (!a.chapterId) return 1;
      if (!b.chapterId) return -1;
      return a.chapterId.localeCompare(b.chapterId);
    });
  }, [wrongItems, userCourseId]);

  // 전체 문제 수 (결합형의 하위 문제 포함, 서술형 제외)
  const totalQuestionCount = useMemo(() => {
    return groupedItems.reduce((sum, group) =>
      sum + group.items.filter(item => item.type !== 'essay').length, 0);
  }, [groupedItems]);

  // 정답 개수
  const correctCount = useMemo(() => {
    return resultsArray.filter(r => r.isCorrect).length;
  }, [resultsArray]);

  // 문제 유형별 라벨
  const typeLabels: Record<string, string> = {
    ox: 'OX',
    multiple: '객관식',
    short: '주관식',
    short_answer: '주관식',
    subjective: '주관식',
  };

  // 복수 정답 여부 확인
  const isMultipleAnswerQuestion = useCallback(() => {
    if (!currentItem) return false;
    const correctAnswerStr = currentItem.correctAnswer?.toString() || '';
    return correctAnswerStr.includes(',');
  }, [currentItem]);

  // 개별 문제 정답 체크 (item과 answer를 인자로 받음)
  const checkSingleAnswer = useCallback((item: ReviewItem, userAnswer: AnswerType): boolean => {
    if (!item || userAnswer === null) return false;

    const correctAnswerStr = item.correctAnswer?.toString() || '';
    const isMultipleAnswer = correctAnswerStr.includes(',');

    if (item.type === 'multiple') {
      if (isMultipleAnswer) {
        const correctIndices = correctAnswerStr.split(',').map(s => parseInt(s.trim(), 10));
        if (Array.isArray(userAnswer)) {
          const userIndices = userAnswer.map(i => i + 1);
          const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
          const sortedUser = [...userIndices].sort((a, b) => a - b);
          return (
            sortedCorrect.length === sortedUser.length &&
            sortedCorrect.every((val, idx) => val === sortedUser[idx])
          );
        }
        return false;
      } else {
        if (typeof userAnswer === 'number') {
          const oneIndexed = (userAnswer + 1).toString();
          return correctAnswerStr === oneIndexed;
        }
        return false;
      }
    }

    if (item.type === 'ox') {
      let normalizedUser = userAnswer.toString().toUpperCase();
      if (normalizedUser === '0') normalizedUser = 'O';
      else if (normalizedUser === '1') normalizedUser = 'X';
      let normalizedCorrect = correctAnswerStr.toUpperCase();
      if (normalizedCorrect === '0') normalizedCorrect = 'O';
      else if (normalizedCorrect === '1') normalizedCorrect = 'X';
      return normalizedUser === normalizedCorrect;
    }

    const userAnswerNormalized = userAnswer.toString().trim().toLowerCase();
    if (correctAnswerStr.includes('|||')) {
      const correctAnswers = correctAnswerStr.split('|||').map(a => a.trim().toLowerCase());
      return correctAnswers.some(ca => userAnswerNormalized === ca);
    }
    return userAnswerNormalized === correctAnswerStr.trim().toLowerCase();
  }, []);

  // 현재 단일 문제 정답 체크 (기존 호환용)
  const checkAnswer = useCallback(() => {
    if (!currentItem || answer === null) return false;
    return checkSingleAnswer(currentItem, answer);
  }, [currentItem, answer, checkSingleAnswer]);

  // 답변 제출
  const handleSubmit = () => {
    if (!currentGroup) return;

    if (currentGroup.isCombined) {
      // 결합형 문제: 각 하위 문제별로 결과 저장
      const groupAnswers = combinedAnswers[currentIndex] || {};
      const newResults: Record<number, PracticeResult> = {};

      currentGroup.items.forEach((item, subIdx) => {
        const subAnswer = groupAnswers[subIdx];
        if (subAnswer !== null && subAnswer !== undefined) {
          const isCorrectAnswer = checkSingleAnswer(item, subAnswer);
          newResults[subIdx] = {
            reviewId: item.id,
            quizId: item.quizId,
            questionId: item.questionId,
            userAnswer: Array.isArray(subAnswer) ? subAnswer.join(',') : subAnswer.toString(),
            isCorrect: isCorrectAnswer,
          };
        }
      });

      // combinedResultsMap에 저장 (그룹 인덱스 -> 하위 인덱스 -> 결과)
      setCombinedResultsMap(prev => ({
        ...prev,
        [currentIndex]: newResults,
      }));
      setSubmittedIndices(prev => new Set(prev).add(currentIndex));
    } else {
      // 단일 문제 (서술형은 미응답도 제출 가능)
      if (currentItem?.type !== 'essay' && (answer === null || (Array.isArray(answer) && answer.length === 0))) return;
      if (!currentItem) return;

      // 서술형은 채점 제외 (항상 isCorrect = false, 결과 표시에서 분기)
      const isCorrectAnswer = currentItem.type === 'essay' ? false : checkAnswer();
      const newResult: PracticeResult = {
        reviewId: currentItem.id,
        quizId: currentItem.quizId,
        questionId: currentItem.questionId,
        userAnswer: answer !== null ? (Array.isArray(answer) ? answer.join(',') : answer.toString()) : '',
        isCorrect: isCorrectAnswer,
      };
      setResultsMap(prev => ({ ...prev, [currentIndex]: newResult }));
      setSubmittedIndices(prev => new Set(prev).add(currentIndex));
    }
  };

  // 다음 문제로 이동
  const handleNext = () => {
    if (isLastQuestion) {
      // 결과 화면으로 이동
      setPhase('result');
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  // 이전 문제로 이동
  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  // 결과 화면에서 피드백 화면으로
  const handleGoToFeedback = () => {
    setPhase('feedback');
  };

  // 피드백 화면에서 완료 — 복습 EXP + 피드백 EXP 합산 토스트
  const handleFinish = () => {
    const revExp = correctCount * 2;
    const fbExp = feedbackSubmitCount * 15;
    const totalExp = revExp + fbExp;
    if (totalExp > 0) {
      const parts: string[] = [];
      if (revExp > 0) parts.push(`복습 ${revExp}`);
      if (fbExp > 0) parts.push(`피드백 ${fbExp}`);
      showExpToast(totalExp, parts.join(' + '));
    }
    onComplete(resultsArray);
  };

  // 새 폴더 생성
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setIsCreatingFolder(true);
    try {
      const folderId = await createCustomFolder(newFolderName.trim());
      if (folderId) {
        setSelectedFolderId(folderId);
        setNewFolderName('');
      }
    } catch (err) {
      console.error('폴더 생성 실패:', err);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // 틀린 문제를 폴더에 저장
  const handleSaveToFolder = async () => {
    if (!selectedFolderId || wrongItems.length === 0) return;
    setIsSaving(true);
    try {
      const questionsToAdd = wrongItems.map(item => ({
        questionId: item.questionId,
        quizId: item.quizId,
        quizTitle: item.quizTitle || '',
        combinedGroupId: item.combinedGroupId || null, // 결합형 그룹 ID 포함
      }));
      await addToCustomFolder(selectedFolderId, questionsToAdd);
      setSaveSuccess(true);
    } catch (err) {
      console.error('저장 실패:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // 문제 펼치기/접기 토글
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 결합형 하위 문제 펼치기/접기 토글
  const toggleSubExpand = (id: string) => {
    setExpandedSubIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 피드백 바텀시트 열기
  const openFeedbackSheet = (item: ReviewItem) => {
    if (submittedFeedbackIds.has(item.questionId)) return;
    setFeedbackTargetItem(item);
  };

  // 피드백 바텀시트 닫기
  const closeFeedbackSheet = () => {
    setFeedbackTargetItem(null);
    setSelectedFeedbackType(null);
    setFeedbackContent('');
  };

  // 피드백 제출
  const handleFeedbackSubmit = async () => {
    if (!feedbackTargetItem || !selectedFeedbackType || !user) return;
    setIsFeedbackSubmitting(true);
    try {
      // quizCreatorId 결정: 아이템에 없으면 퀴즈에서 가져옴
      let creatorId = feedbackTargetItem.quizCreatorId || null;
      if (!creatorId && feedbackTargetItem.quizId) {
        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', feedbackTargetItem.quizId));
          if (quizDoc.exists()) {
            creatorId = quizDoc.data()?.creatorId || null;
          }
        } catch (e) {
          console.error('퀴즈 creatorId 로드 실패:', e);
        }
      }

      // questionId에서 문제 번호 추출 (예: "q0" → 1, "q2-1" → 3)
      const qMatch = feedbackTargetItem.questionId.match(/^q(\d+)/);
      const questionNumber = qMatch ? parseInt(qMatch[1], 10) + 1 : 1;

      const feedbackRef = collection(db, 'questionFeedbacks');
      await addDoc(feedbackRef, {
        questionId: feedbackTargetItem.questionId,
        quizId: feedbackTargetItem.quizId,
        quizCreatorId: creatorId, // 퀴즈 생성자 ID (조회 최적화용)
        userId: user.uid,
        questionNumber, // 문제 번호 (표시용)
        type: selectedFeedbackType,
        content: feedbackContent,
        createdAt: serverTimestamp(),
      });
      setSubmittedFeedbackIds(prev => new Set(prev).add(feedbackTargetItem.questionId));
      setFeedbackSubmitCount(prev => prev + 1);
      closeFeedbackSheet();
    } catch (err) {
      console.error('피드백 제출 실패:', err);
      alert('피드백 제출에 실패했습니다.');
    } finally {
      setIsFeedbackSubmitting(false);
    }
  };

  // 정답 여부 (제출된 경우 저장된 결과 사용)
  const isCorrect = isSubmitted && resultsMap[currentIndex]?.isCorrect;

  // 진행률 계산
  const progress = ((currentIndex + 1) / totalCount) * 100;

  // ========== 결과 화면 ==========
  if (phase === 'result') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        {/* 헤더 */}
        <header className="sticky top-0 z-50 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <div className="flex items-center justify-between h-12 px-4" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="w-10" />
            <h1 className="text-sm font-bold text-[#1A1A1A]">{headerTitle} 결과</h1>
            <div className="w-10" />
          </div>
        </header>

        <main className="px-4 py-5 pb-24">
          {/* 점수 */}
          <div className="text-center mb-5">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-5xl font-black text-[#1A1A1A]">{correctCount}</span>
              <span className="text-2xl text-[#5C5C5C]">/</span>
              <span className="text-2xl text-[#5C5C5C]">{totalQuestionCount}</span>
            </div>
            <p className="text-base text-[#5C5C5C]">
              정답률 {Math.round((correctCount / totalQuestionCount) * 100)}%
            </p>
          </div>

          {/* 문제 목록 */}
          <div className="space-y-2">
            {groupedItems.map((group, groupIdx) => {
              if (group.isCombined) {
                // 결합형 문제 그룹
                const firstItem = group.items[0];
                const groupResults = combinedResultsMap[groupIdx] || {};
                const groupCorrectCount = group.items.filter((_, subIdx) => groupResults[subIdx]?.isCorrect).length;
                const isGroupExpanded = expandedIds.has(group.groupId || `group-${groupIdx}`);

                return (
                  <div key={group.groupId || `group-${groupIdx}`} className="border border-[#1A1A1A] bg-[#F5F0E8]">
                    {/* 결합형 그룹 헤더 */}
                    <div
                      onClick={() => toggleExpand(group.groupId || `group-${groupIdx}`)}
                      className="p-2.5 cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* 문항 번호 + 결합형 표시 + 정답 수 */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                              Q{groupIdx + 1}
                            </span>
                            <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                              결합형 문제
                            </span>
                            <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold ${
                              groupCorrectCount === group.items.length
                                ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                                : groupCorrectCount > 0
                                ? 'bg-[#FFF8E1] text-[#8B6914] border border-[#8B6914]'
                                : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
                            }`}>
                              {groupCorrectCount}/{group.items.length} 정답
                            </span>
                          </div>
                          {/* 공통 문제 내용 표시 */}
                          {firstItem.commonQuestion && (
                            <p className="text-xs font-medium text-[#1A1A1A] line-clamp-2 pl-1">
                              {firstItem.commonQuestion}
                            </p>
                          )}
                        </div>

                        {/* 화살표 */}
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <svg
                            className={`w-4 h-4 text-[#5C5C5C] transition-transform mt-1 ${isGroupExpanded ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* 결합형 그룹 상세 */}
                    <AnimatePresence>
                      {isGroupExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-[#1A1A1A] p-3 bg-[#EDEAE4] space-y-3">
                            {/* 공통 문제는 아코디언 헤더에 표시되므로 생략 */}

                            {/* 공통 지문/이미지 (노란색 박스) */}
                            {(firstItem.passage || firstItem.passageImage || (firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0) || (firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0)) && (
                              <div className="p-2 border border-[#8B6914] bg-[#FFF8E1]">
                                {firstItem.passage && firstItem.passageType !== 'korean_abc' && firstItem.passageType !== 'mixed' && (
                                  <p className="text-xs text-[#1A1A1A]">{firstItem.passage}</p>
                                )}
                                {firstItem.passageType === 'korean_abc' && firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0 && (
                                  <div className="space-y-1">
                                    {firstItem.koreanAbcItems.map((itm, i) => (
                                      <p key={i} className="text-xs text-[#1A1A1A]">
                                        <span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                {firstItem.passageType === 'mixed' && firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0 && (
                                  <div className="space-y-2">
                                    {firstItem.passageMixedExamples.map((block: any) => (
                                      <div key={block.id}>
                                        {block.type === 'grouped' && (
                                          <div className="space-y-1">
                                            {(block.children || []).map((child: any) => (
                                              <div key={child.id}>
                                                {child.type === 'text' && child.content?.trim() && (
                                                  <p className="text-xs text-[#5C5C5C]">{child.content}</p>
                                                )}
                                                {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                                                  <p key={item.id} className="text-xs text-[#1A1A1A]">
                                                    <span className="font-bold mr-1">{item.label}.</span>
                                                    {item.content}
                                                  </p>
                                                ))}
                                                {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                                                  <p key={item.id} className="text-xs text-[#1A1A1A]">
                                                    <span className="font-bold mr-1">({item.label})</span>
                                                    {item.content}
                                                  </p>
                                                ))}
                                                {child.type === 'image' && child.imageUrl && (
                                                  <img src={child.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {block.type === 'text' && block.content?.trim() && (
                                          <p className="text-xs text-[#1A1A1A]">{block.content}</p>
                                        )}
                                        {block.type === 'labeled' && (block.items || []).length > 0 && (
                                          <div className="space-y-1">
                                            {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                                              <p key={item.id} className="text-xs text-[#1A1A1A]">
                                                <span className="font-bold mr-1">{item.label}.</span>
                                                {item.content}
                                              </p>
                                            ))}
                                          </div>
                                        )}
                                        {block.type === 'gana' && (block.items || []).length > 0 && (
                                          <div className="space-y-1">
                                            {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                                              <p key={item.id} className="text-xs text-[#1A1A1A]">
                                                <span className="font-bold mr-1">({item.label})</span>
                                                {item.content}
                                              </p>
                                            ))}
                                          </div>
                                        )}
                                        {block.type === 'image' && block.imageUrl && (
                                          <img src={block.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {firstItem.passageImage && (
                                  <img src={firstItem.passageImage} alt="공통 이미지" className="mt-2 max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                                )}
                              </div>
                            )}

                            {/* 하위 문제들 */}
                            <div className="space-y-2">
                              {group.items.map((subItem, subIdx) => {
                                const subResult = groupResults[subIdx];
                                const isSubCorrect = subResult?.isCorrect;
                                const isSubExpanded = expandedSubIds.has(subItem.id);
                                const isOwnQuestion = currentUserId && subItem.quizCreatorId === currentUserId;
                                const isMultipleAnswer = subItem.correctAnswer?.toString().includes(',');

                                return (
                                  <div key={subItem.id} className="border border-[#D4CFC4] bg-[#F5F0E8]">
                                    {/* 하위 문제 헤더 */}
                                    <div
                                      onClick={() => toggleSubExpand(subItem.id)}
                                      className="p-2 cursor-pointer flex items-center justify-between"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className={`w-5 h-5 flex items-center justify-center text-xs font-bold ${
                                            isSubCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'
                                          }`}>
                                            {isSubCorrect ? 'O' : 'X'}
                                          </span>
                                          <span className="text-xs font-bold text-[#1A1A1A]">
                                            Q{groupIdx + 1}-{subIdx + 1}
                                          </span>
                                        </div>
                                        <p className="text-xs font-medium text-[#1A1A1A] line-clamp-1 mt-1 pl-7">
                                          {subItem.question}
                                        </p>
                                      </div>
                                      <svg
                                        className={`w-4 h-4 text-[#5C5C5C] transition-transform flex-shrink-0 ${isSubExpanded ? 'rotate-180' : ''}`}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </div>

                                    {/* 하위 문제 상세 */}
                                    <AnimatePresence>
                                      {isSubExpanded && (
                                        <motion.div
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          className="overflow-hidden"
                                        >
                                          <div className="border-t border-[#D4CFC4] p-2 bg-[#EDEAE4] space-y-2">
                                            {/* 문제 텍스트는 아코디언 헤더에 표시되므로 생략 */}

                                            {/* 문제 이미지 */}
                                            {subItem.image && (
                                              <img src={subItem.image} alt="문제 이미지" className="max-w-full max-h-[150px] object-contain border border-[#1A1A1A]" />
                                            )}

                                            {/* 지문 - 혼합 형식 (mixedExamples) */}
                                            {subItem.mixedExamples && subItem.mixedExamples.length > 0 && (
                                              <div className="space-y-2">
                                                <p className="text-xs font-bold text-[#8B6914]">지문</p>
                                                {subItem.mixedExamples.map((block: any) => (
                                                  <div key={block.id}>
                                                    {block.type === 'grouped' && (block.children?.length ?? 0) > 0 && (
                                                      <div className="p-2 bg-[#FFF8E1] border-2 border-[#8B6914] space-y-1">
                                                        {(block.children || []).map((child: any) => (
                                                          <div key={child.id}>
                                                            {child.type === 'text' && child.content?.trim() && (
                                                              <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                                                            )}
                                                            {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                                              <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                                                <span className="font-bold mr-1">{itm.label}.</span>{itm.content}
                                                              </p>
                                                            ))}
                                                            {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                                              <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                                                <span className="font-bold mr-1">({itm.label})</span>{itm.content}
                                                              </p>
                                                            ))}
                                                            {child.type === 'image' && child.imageUrl && (
                                                              <img src={child.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                                            )}
                                                          </div>
                                                        ))}
                                                      </div>
                                                    )}
                                                    {block.type === 'text' && block.content?.trim() && (
                                                      <div className="p-2 bg-[#FFF8E1] border border-[#8B6914]">
                                                        <p className="text-[#1A1A1A] text-xs whitespace-pre-wrap">{block.content}</p>
                                                      </div>
                                                    )}
                                                    {block.type === 'labeled' && (block.items || []).length > 0 && (
                                                      <div className="p-2 bg-[#FFF8E1] border border-[#8B6914] space-y-1">
                                                        {(block.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                                          <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                                            <span className="font-bold mr-1">{itm.label}.</span>{itm.content}
                                                          </p>
                                                        ))}
                                                      </div>
                                                    )}
                                                    {block.type === 'gana' && (block.items || []).length > 0 && (
                                                      <div className="p-2 bg-[#FFF8E1] border border-[#8B6914] space-y-1">
                                                        {(block.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                                          <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                                            <span className="font-bold mr-1">({itm.label})</span>{itm.content}
                                                          </p>
                                                        ))}
                                                      </div>
                                                    )}
                                                    {block.type === 'image' && block.imageUrl && (
                                                      <div className="border border-[#1A1A1A] overflow-hidden">
                                                        <img src={block.imageUrl} alt="지문 이미지" className="max-w-full h-auto" />
                                                      </div>
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            )}

                                            {/* 지문 - 레거시 형식 (subQuestionOptions) */}
                                            {!subItem.mixedExamples && subItem.subQuestionOptions && subItem.subQuestionOptions.length > 0 && (
                                              <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                                                <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                                                {subItem.subQuestionOptionsType === 'text' ? (
                                                  <p className="text-xs text-[#1A1A1A]">
                                                    {subItem.subQuestionOptions.join(', ')}
                                                  </p>
                                                ) : (
                                                  <div className="space-y-1">
                                                    {subItem.subQuestionOptions.map((opt, i) => (
                                                      <p key={i} className="text-xs text-[#1A1A1A]">
                                                        <span className="font-bold">{KOREAN_LABELS[i]}.</span> {opt}
                                                      </p>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                            )}

                                            {/* 객관식 선지 */}
                                            {subItem.options && subItem.options.length > 0 && (
                                              <div className="space-y-1">
                                                {subItem.options.map((opt, optIdx) => {
                                                  const optionNum = (optIdx + 1).toString();
                                                  const correctAnswerStr = subItem.correctAnswer?.toString() || '';
                                                  const correctAnswers = correctAnswerStr.includes(',')
                                                    ? correctAnswerStr.split(',').map(a => a.trim())
                                                    : [correctAnswerStr];
                                                  const isCorrectOption = correctAnswers.includes(optionNum);

                                                  const userAnswerStr = subResult?.userAnswer || '';
                                                  const userAnswers = userAnswerStr.includes(',')
                                                    ? userAnswerStr.split(',').map(a => (parseInt(a.trim(), 10) + 1).toString())
                                                    : userAnswerStr ? [(parseInt(userAnswerStr, 10) + 1).toString()] : [];
                                                  const isUserAnswer = userAnswers.includes(optionNum);

                                                  let className = 'border-[#D4CFC4] text-[#5C5C5C] bg-[#F5F0E8]';
                                                  if (isCorrectOption) {
                                                    className = 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
                                                  } else if (isUserAnswer) {
                                                    className = 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
                                                  }

                                                  return (
                                                    <div key={optIdx} className={`px-2 py-1 text-xs border ${className}`}>
                                                      {optIdx + 1}. {opt}
                                                      {isMultipleAnswer && isCorrectOption && ' (정답)'}
                                                      {isMultipleAnswer && isUserAnswer && ' (내 선택)'}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            )}

                                            {/* OX/주관식 답 (하위 문제용) */}
                                            {(!subItem.options || subItem.options.length === 0) && (
                                              <div className="text-xs space-y-1">
                                                <p>
                                                  <span className="text-[#5C5C5C]">내 답: </span>
                                                  <span className={`font-bold ${isSubCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                                                    {subResult?.userAnswer || '(미응답)'}
                                                  </span>
                                                </p>
                                                {!isSubCorrect && (
                                                  <p>
                                                    <span className="text-[#5C5C5C]">정답: </span>
                                                    <span className="font-bold text-[#1A6B1A]">
                                                      {subItem.type === 'ox'
                                                        ? (subItem.correctAnswer?.toString() === '0' || subItem.correctAnswer?.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                                        : (subItem.correctAnswer?.toString().replace(/\|\|\|/g, ', ') || '')}
                                                    </span>
                                                  </p>
                                                )}
                                              </div>
                                            )}

                                            {/* 해설 */}
                                            <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A]">
                                              <p className="text-xs font-bold text-[#5C5C5C]">해설</p>
                                              <p className="text-xs text-[#1A1A1A]">
                                                {subItem.explanation || '해설이 없습니다.'}
                                              </p>
                                            </div>

                                            {/* 피드백 버튼 - AI 생성 문제가 아니고 본인 문제가 아닌 경우에만 표시 */}
                                            {showFeedback && !isOwnQuestion && subItem.quizType !== 'ai-generated' && (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  openFeedbackSheet(subItem);
                                                }}
                                                disabled={submittedFeedbackIds.has(subItem.questionId)}
                                                className="w-full py-1 text-xs border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4] disabled:opacity-50"
                                              >
                                                {submittedFeedbackIds.has(subItem.questionId) ? '피드백 완료' : '피드백 남기기'}
                                              </button>
                                            )}
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              } else {
                // 단일 문제
                const item = group.items[0];
                const result = resultsMap[groupIdx];
                const isItemCorrect = result?.isCorrect;
                const isExpanded = expandedIds.has(item.id);
                const isOwnQuestion = currentUserId && item.quizCreatorId === currentUserId;
                const isMultipleAnswer = item.correctAnswer?.toString().includes(',');

                return (
                  <div key={item.id} className="border border-[#1A1A1A] bg-[#F5F0E8]">
                    {/* 문제 헤더 */}
                    <div
                      onClick={() => toggleExpand(item.id)}
                      className="p-2.5 cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* 첫 줄: 정답/오답 + 문항번호 + 챕터 + 문제유형 */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className={`w-5 h-5 flex items-center justify-center text-[10px] font-bold ${
                              item.type === 'essay'
                                ? 'bg-[#8B6914] text-white'
                                : isItemCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'
                            }`}>
                              {item.type === 'essay' ? '✎' : isItemCorrect ? 'O' : 'X'}
                            </span>
                            <span className="text-xs font-bold text-[#1A1A1A]">
                              Q{groupIdx + 1}
                            </span>
                            {userCourseId && item.chapterId && (
                              <span className="px-1 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-[10px] font-medium">
                                {formatChapterLabel(userCourseId, item.chapterId, item.chapterDetailId)}
                              </span>
                            )}
                            <span className="px-1 py-0.5 text-[10px] border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                              {item.type === 'ox' ? 'OX문제' : item.type === 'multiple' ? '객관식문제' : item.type === 'essay' ? '서술형문제' : '주관식문제'}
                            </span>
                          </div>
                          {/* 둘째 줄: 문제 내용 + 발문 */}
                          <p className="text-xs font-medium text-[#1A1A1A] line-clamp-2 pl-7">
                            {item.question}
                            {/* 제시문 발문 또는 보기 발문 표시 */}
                            {(item.passagePrompt || item.bogiQuestionText) && (
                              <span className="ml-1 text-[#5C5C5C] font-normal">
                                {item.passagePrompt || item.bogiQuestionText}
                              </span>
                            )}
                          </p>
                        </div>
                        <svg
                          className={`w-4 h-4 text-[#5C5C5C] transition-transform flex-shrink-0 mt-1 ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                  {/* 문제 상세 */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-[#1A1A1A] p-3 bg-[#EDEAE4] space-y-3">
                          {/* 결합형 공통 정보 - 공통 문제는 아코디언 헤더에 표시되므로 생략 */}
                          {item.combinedGroupId && (item.passage || item.passageImage || item.koreanAbcItems || item.passageMixedExamples) && (
                            <div className="space-y-2">
                              {(item.passage || item.passageImage || item.koreanAbcItems || item.passageMixedExamples) && (
                                <div className="p-2 border border-[#8B6914] bg-[#FFF8E1]">
                                  {item.passage && item.passageType !== 'korean_abc' && item.passageType !== 'mixed' && (
                                    <p className="text-xs text-[#1A1A1A]">{item.passage}</p>
                                  )}
                                  {item.passageType === 'korean_abc' && item.koreanAbcItems && item.koreanAbcItems.length > 0 && (
                                    <div className="space-y-1">
                                      {item.koreanAbcItems.map((itm, i) => (
                                        <p key={i} className="text-xs text-[#1A1A1A]">
                                          <span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                  {item.passageType === 'mixed' && item.passageMixedExamples && item.passageMixedExamples.length > 0 && (
                                    <div className="space-y-2">
                                      {item.passageMixedExamples.map((block: any) => (
                                        <div key={block.id}>
                                          {block.type === 'grouped' && (
                                            <div className="space-y-1">
                                              {(block.children || []).map((child: any) => (
                                                <div key={child.id}>
                                                  {child.type === 'text' && child.content?.trim() && (
                                                    <p className="text-xs text-[#5C5C5C]">{child.content}</p>
                                                  )}
                                                  {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((it: any) => (
                                                    <p key={it.id} className="text-xs text-[#1A1A1A]">
                                                      <span className="font-bold mr-1">{it.label}.</span>
                                                      {it.content}
                                                    </p>
                                                  ))}
                                                  {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((it: any) => (
                                                    <p key={it.id} className="text-xs text-[#1A1A1A]">
                                                      <span className="font-bold mr-1">({it.label})</span>
                                                      {it.content}
                                                    </p>
                                                  ))}
                                                  {child.type === 'image' && child.imageUrl && (
                                                    <img src={child.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'text' && block.content?.trim() && (
                                            <p className="text-xs text-[#1A1A1A]">{block.content}</p>
                                          )}
                                          {block.type === 'labeled' && (block.items || []).length > 0 && (
                                            <div className="space-y-1">
                                              {(block.items || []).filter((i: any) => i.content?.trim()).map((it: any) => (
                                                <p key={it.id} className="text-xs text-[#1A1A1A]">
                                                  <span className="font-bold mr-1">{it.label}.</span>
                                                  {it.content}
                                                </p>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'gana' && (block.items || []).length > 0 && (
                                            <div className="space-y-1">
                                              {(block.items || []).filter((i: any) => i.content?.trim()).map((it: any) => (
                                                <p key={it.id} className="text-xs text-[#1A1A1A]">
                                                  <span className="font-bold mr-1">({it.label})</span>
                                                  {it.content}
                                                </p>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'image' && block.imageUrl && (
                                            <img src={block.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {item.passageImage && (
                                    <img src={item.passageImage} alt="공통 이미지" className="mt-2 max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 문제 텍스트는 아코디언 헤더에 표시되므로 생략 */}

                          {/* 1. 지문 - 혼합 형식 (mixedExamples) - 이미지보다 먼저 */}
                          {item.mixedExamples && item.mixedExamples.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-[#8B6914]">지문</p>
                              {item.mixedExamples.map((block: any) => (
                                <div key={block.id}>
                                  {/* 묶음 블록 */}
                                  {block.type === 'grouped' && (block.children?.length ?? 0) > 0 && (
                                    <div className="p-3 bg-[#FFF8E1] border-2 border-[#8B6914] space-y-1">
                                      {(block.children || []).map((child: any) => (
                                        <div key={child.id}>
                                          {child.type === 'text' && child.content?.trim() && (
                                            <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                                          )}
                                          {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                            <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                              <span className="font-bold mr-1">{itm.label}.</span>
                                              {itm.content}
                                            </p>
                                          ))}
                                          {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                            <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                              <span className="font-bold mr-1">({itm.label})</span>
                                              {itm.content}
                                            </p>
                                          ))}
                                          {child.type === 'image' && child.imageUrl && (
                                            <img src={child.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* 텍스트 블록 */}
                                  {block.type === 'text' && block.content?.trim() && (
                                    <div className="p-3 bg-[#FFF8E1] border border-[#8B6914]">
                                      <p className="text-[#1A1A1A] text-xs whitespace-pre-wrap">{block.content}</p>
                                    </div>
                                  )}
                                  {/* ㄱㄴㄷ 블록 */}
                                  {block.type === 'labeled' && (block.items || []).length > 0 && (
                                    <div className="p-3 bg-[#FFF8E1] border border-[#8B6914] space-y-1">
                                      {(block.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                        <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">{itm.label}.</span>
                                          {itm.content}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                  {/* (가)(나)(다) 블록 */}
                                  {block.type === 'gana' && (block.items || []).length > 0 && (
                                    <div className="p-3 bg-[#FFF8E1] border border-[#8B6914] space-y-1">
                                      {(block.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                        <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">({itm.label})</span>
                                          {itm.content}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                  {/* 이미지 블록 */}
                                  {block.type === 'image' && block.imageUrl && (
                                    <div className="border border-[#1A1A1A] overflow-hidden">
                                      <img src={block.imageUrl} alt="지문 이미지" className="max-w-full h-auto" />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* 2. 지문 - 레거시 형식 (subQuestionOptions) */}
                          {!item.mixedExamples && item.subQuestionOptions && item.subQuestionOptions.length > 0 && (
                            <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                              <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                              {item.subQuestionOptionsType === 'text' ? (
                                <p className="text-xs text-[#1A1A1A]">
                                  {item.subQuestionOptions.join(', ')}
                                </p>
                              ) : (
                                <div className="space-y-1">
                                  {item.subQuestionOptions.map((opt, i) => (
                                    <p key={i} className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold">{KOREAN_LABELS[i]}.</span> {opt}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 3. 문제 이미지 - 지문 다음에 표시 */}
                          {item.image && (
                            <img src={item.image} alt="문제 이미지" className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                          )}
                          {/* AI 크롭 이미지 (HARD 난이도 문제) */}
                          {item.imageUrl && (
                            <img src={item.imageUrl} alt="문제 관련 자료" className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                          )}

                          {/* 하위 문제 이미지 */}
                          {item.subQuestionImage && (
                            <img src={item.subQuestionImage} alt="지문 이미지" className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A]" />
                          )}

                          {/* 4. 보기 (<보기> 박스) - 이미지 다음, 발문 전에 표시 */}
                          {item.bogi && item.bogi.items && item.bogi.items.some(i => i.content?.trim()) && (
                            <div className="p-2 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                              <p className="text-[10px] text-center text-[#5C5C5C] mb-1.5 font-bold">&lt;보 기&gt;</p>
                              <div className="space-y-1">
                                {item.bogi.items.filter(i => i.content?.trim()).map((bogiItem, idx) => (
                                  <p key={idx} className="text-xs text-[#1A1A1A]">
                                    <span className="font-bold mr-1">{bogiItem.label}.</span>
                                    {bogiItem.content}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 5. 발문 (제시문 발문 + 보기 발문 합침, 선지 전에 표시) */}
                          {(item.passagePrompt || item.bogiQuestionText) && (
                            <div className="p-2 border border-[#1A1A1A] bg-[#F5F0E8]">
                              <p className="text-xs text-[#1A1A1A]">
                                {item.passagePrompt && item.bogiQuestionText
                                  ? `${item.passagePrompt} ${item.bogiQuestionText}`
                                  : item.passagePrompt || item.bogiQuestionText}
                              </p>
                            </div>
                          )}

                          {/* 6. 객관식 선지 */}
                          {item.options && item.options.length > 0 && (
                            <div className="space-y-1">
                              {item.options.map((opt, optIdx) => {
                                const optionNum = (optIdx + 1).toString();
                                const correctAnswerStr = item.correctAnswer?.toString() || '';
                                const correctAnswers = correctAnswerStr.includes(',')
                                  ? correctAnswerStr.split(',').map(a => a.trim())
                                  : [correctAnswerStr];
                                const isCorrectOption = correctAnswers.includes(optionNum);

                                const userAnswerStr = result?.userAnswer || '';
                                const userAnswers = userAnswerStr.includes(',')
                                  ? userAnswerStr.split(',').map(a => (parseInt(a.trim(), 10) + 1).toString())
                                  : userAnswerStr ? [(parseInt(userAnswerStr, 10) + 1).toString()] : [];
                                const isUserAnswer = userAnswers.includes(optionNum);

                                let className = 'border-[#D4CFC4] text-[#5C5C5C] bg-[#F5F0E8]';
                                if (isCorrectOption) {
                                  className = 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
                                } else if (isUserAnswer) {
                                  className = 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
                                }

                                return (
                                  <p key={optIdx} className={`text-xs p-2 border ${className}`}>
                                    {optIdx + 1}. {opt}
                                    {isMultipleAnswer && isCorrectOption && ' (정답)'}
                                    {isMultipleAnswer && isUserAnswer && ' (내 선택)'}
                                  </p>
                                );
                              })}
                            </div>
                          )}

                          {/* OX/주관식/서술형 답 */}
                          {(!item.options || item.options.length === 0) && (
                            item.type === 'essay' ? (
                              <div className="text-xs space-y-1">
                                <p>
                                  <span className="text-[#5C5C5C]">내 답: </span>
                                  <span className="font-bold text-[#1A1A1A]">
                                    {result?.userAnswer || '(미응답)'}
                                  </span>
                                </p>
                              </div>
                            ) : (
                            <div className="text-xs space-y-1">
                              <p>
                                <span className="text-[#5C5C5C]">내 답: </span>
                                <span className={`font-bold ${isItemCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                                  {result?.userAnswer || '(미응답)'}
                                </span>
                              </p>
                              {!isItemCorrect && (
                                <p>
                                  <span className="text-[#5C5C5C]">정답: </span>
                                  <span className="font-bold text-[#1A6B1A]">
                                    {item.type === 'ox'
                                      ? (item.correctAnswer?.toString() === '0' || item.correctAnswer?.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                      : (item.correctAnswer?.toString().replace(/\|\|\|/g, ', ') || '')}
                                  </span>
                                </p>
                              )}
                            </div>
                            )
                          )}

                          {/* 해설 */}
                          {item.explanation && (
                            <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A]">
                              <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                              <p className="text-xs text-[#1A1A1A]">{item.explanation}</p>
                            </div>
                          )}

                          {/* 피드백 버튼 - AI 생성 문제가 아니고 본인 문제가 아닌 경우에만 표시 */}
                          {showFeedback && !isOwnQuestion && item.quizType !== 'ai-generated' && (
                            <div className="pt-2 border-t border-[#D4CFC4]">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openFeedbackSheet(item);
                                }}
                                disabled={submittedFeedbackIds.has(item.questionId)}
                                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border transition-colors rounded-lg ${
                                  submittedFeedbackIds.has(item.questionId)
                                    ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A] cursor-default'
                                    : 'bg-[#FFF8E1] border-[#8B6914] text-[#8B6914] hover:bg-[#FFECB3]'
                                }`}
                              >
                                {submittedFeedbackIds.has(item.questionId) ? (
                                  <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    피드백 완료
                                  </>
                                ) : (
                                  <>
                                    <span className="w-5 h-5 flex items-center justify-center bg-[#8B6914] text-[#FFF8E1] font-bold text-xs">!</span>
                                    문제 피드백
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
              }
            })}
          </div>
        </main>

        {/* 하단 버튼 */}
        <div className="fixed bottom-0 left-0 right-0 p-3 border-t-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <div className="flex gap-2.5">
            <button
              onClick={() => setPhase('practice')}
              className="flex-1 py-3 text-sm bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
            >
              이전
            </button>
            <button
              onClick={handleGoToFeedback}
              className="flex-[2] py-3 text-sm bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
            >
              다음
            </button>
          </div>
        </div>

        {/* 피드백 바텀시트 */}
        <BottomSheet
          isOpen={!!feedbackTargetItem}
          onClose={closeFeedbackSheet}
          title="문제 피드백"
          height="auto"
          zIndex="z-[70]"
        >
          <div className="space-y-3">
            {/* 피드백 유형 선택 */}
            <div>
              <p className="text-xs text-[#5C5C5C] mb-2">이 문제에 대한 의견을 선택해주세요</p>
              <div className="grid grid-cols-2 gap-1.5">
                {FEEDBACK_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() => setSelectedFeedbackType(type)}
                    className={`p-2 border-2 text-xs font-bold transition-all rounded-lg ${
                      selectedFeedbackType === type
                        ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                        : 'border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 추가 내용 입력 */}
            <AnimatePresence>
              {selectedFeedbackType && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="block text-xs text-[#5C5C5C] mb-1.5">추가 의견 (선택)</label>
                  <textarea
                    value={feedbackContent}
                    onChange={(e) => setFeedbackContent(e.target.value)}
                    placeholder="자세한 내용을 적어주세요"
                    rows={3}
                    maxLength={200}
                    className="w-full p-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] focus:outline-none resize-none text-xs"
                  />
                  <p className="text-[10px] text-[#5C5C5C] text-right mt-0.5">{feedbackContent.length}/200</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 제출 버튼 */}
            <button
              onClick={handleFeedbackSubmit}
              disabled={!selectedFeedbackType || isFeedbackSubmitting}
              className={`w-full py-2.5 text-sm font-bold border-2 transition-colors rounded-lg ${
                selectedFeedbackType
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
              }`}
            >
              {isFeedbackSubmitting ? '제출 중...' : '피드백 보내기'}
            </button>
            <p className="text-[10px] text-[#5C5C5C] text-center">피드백은 익명으로 전달됩니다.</p>
          </div>
        </BottomSheet>
      </motion.div>
    );
  }

  // 복습 EXP 계산 (정답당 2 EXP)
  const reviewExp = correctCount * 2;

  // 피드백 EXP 계산
  const feedbackExp = feedbackSubmitCount * 15;
  // 총 획득 EXP (복습 + 피드백)
  const totalDisplayExp = reviewExp + feedbackExp;

  // ========== 피드백 화면 ==========
  if (phase === 'feedback') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[60] flex flex-col overscroll-contain"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        {/* 헤더 */}
        <header className="shrink-0 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <div className="flex items-center justify-center h-12 px-4">
            <h1 className="text-base font-bold text-[#1A1A1A]">{headerTitle} 완료</h1>
          </div>
        </header>

        {/* 스크롤 가능한 본문 — 하단 버튼 영역 확보 */}
        <main className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 pb-20">
          {/* 결과 요약 — 축소 */}
          <div className="text-center mb-3">
            <div className="w-11 h-11 mx-auto mb-2 bg-[#1A1A1A] rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">{headerTitle}을 완료했습니다!</h2>
            <p className="text-sm text-[#5C5C5C] mt-1">
              {totalQuestionCount}문제 중 {correctCount}문제 정답
            </p>
          </div>

          {/* 총 획득 EXP */}
          <div className="bg-[#1A1A1A] p-3 mb-3 rounded-lg">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-[#F5F0E8]">총 획득 경험치</p>
              <p className="text-base font-bold text-[#F5F0E8]">+{totalDisplayExp} XP</p>
            </div>
          </div>

          {/* 틀린 문제 폴더 저장 — 축소 */}
          {wrongItems.length > 0 && !saveSuccess && (
            <div className="border-2 border-[#1A1A1A] bg-[#F5F0E8] p-3 rounded-lg">
              <h3 className="text-sm font-bold text-[#1A1A1A] mb-2">
                틀린 문제 {wrongItems.length}개를 폴더에 저장
              </h3>

              {/* 챕터별 틀린 문제 수 */}
              {chapterGroupedWrongItems.length > 0 && (
                <div className="mb-1.5 p-1 bg-[#EDEAE4] border border-[#D4CFC4]">
                  <div className="space-y-0.5">
                    {chapterGroupedWrongItems.map((group) => (
                      <div key={group.chapterId || 'uncategorized'} className="flex items-center justify-between text-[10px]">
                        <span className="text-[#5C5C5C]">{group.chapterName}</span>
                        <span className="font-bold text-[#8B1A1A]">{group.items.length}문제</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 기존 폴더 선택 */}
              {customFolders.length > 0 && (
                <div className="mb-1.5">
                  <p className="text-[10px] text-[#5C5C5C] mb-0.5">기존 폴더 선택</p>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto overscroll-contain">
                    {customFolders.map(folder => (
                      <button
                        key={folder.id}
                        onClick={() => setSelectedFolderId(folder.id)}
                        className={`w-full text-left px-3 py-1.5 text-xs border transition-colors rounded-lg ${
                          selectedFolderId === folder.id
                            ? 'border-[#1A1A1A] bg-[#EDEAE4] font-bold'
                            : 'border-[#EDEAE4] hover:border-[#1A1A1A]'
                        }`}
                      >
                        {folder.name} ({folder.questions.length}문제)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 새 폴더 생성 */}
              <div className="mb-2">
                <p className="text-xs text-[#5C5C5C] mb-1">새 폴더 만들기</p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="폴더 이름 입력"
                    className="flex-1 px-3 py-1.5 text-xs border border-[#1A1A1A] bg-[#F5F0E8] outline-none focus:border-2 rounded-lg"
                  />
                  <button
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    className="shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-50 rounded-lg"
                  >
                    {isCreatingFolder ? '...' : '생성'}
                  </button>
                </div>
              </div>

              {/* 저장 버튼 */}
              {selectedFolderId && (
                <button
                  onClick={handleSaveToFolder}
                  disabled={isSaving}
                  className="w-full py-2 text-xs font-bold bg-[#1A6B1A] text-[#F5F0E8] hover:bg-[#155415] transition-colors disabled:opacity-50 rounded-lg"
                >
                  {isSaving ? '저장 중...' : `선택한 폴더에 ${wrongItems.length}문제 저장`}
                </button>
              )}
            </div>
          )}

          {/* 저장 완료 메시지 — 축소 */}
          {saveSuccess && (
            <div className="border-2 border-[#1A6B1A] bg-[#E8F5E9] p-3 text-center rounded-lg">
              <svg className="w-8 h-8 mx-auto mb-1 text-[#1A6B1A]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <p className="text-xs font-bold text-[#1A6B1A]">저장되었습니다!</p>
              <p className="text-xs text-[#5C5C5C] mt-0.5">
                커스텀 폴더에서 확인할 수 있습니다.
              </p>
            </div>
          )}

          {/* 틀린 문제가 없는 경우 — 축소 */}
          {wrongItems.length === 0 && (
            <div className="border-2 border-[#1A6B1A] bg-[#E8F5E9] p-3 text-center rounded-lg">
              <svg className="w-8 h-8 mx-auto mb-1 text-[#1A6B1A]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <p className="text-[11px] font-bold text-[#1A6B1A]">모든 문제를 맞혔습니다!</p>
            </div>
          )}
        </main>

        {/* 하단 버튼 — 항상 보이도록 fixed */}
        <div className="shrink-0 p-2.5 border-t-2 border-[#1A1A1A] bg-[#F5F0E8]">
          <div className="flex gap-2">
            <button
              onClick={() => setPhase('result')}
              className="flex-1 py-3 text-sm bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
            >
              이전
            </button>
            <button
              onClick={handleFinish}
              className="flex-[2] py-3 text-sm bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
            >
              완료
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  // ========== 문제 풀이 화면 ==========
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ backgroundColor: '#F5F0E8' }}
    >
      {/* 헤더 */}
      <header
        className="sticky top-0 z-[60] w-full border-b-2 border-[#1A1A1A]"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        <div className="flex items-center justify-between h-14 px-4" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onClose()}
            className="p-2 -ml-2 transition-colors duration-200 text-[#1A1A1A] hover:bg-[#EDEAE4]"
            aria-label="나가기"
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
          </motion.button>

          <div className="text-center">
            <h1 className="text-base font-bold text-[#1A1A1A]">{headerTitle}</h1>
            {(quizTitle || currentItem?.quizTitle || currentGroup?.items[0]?.quizTitle) && (
              <p className="text-xs text-[#5C5C5C] mt-0.5 truncate max-w-[200px]">
                {quizTitle || currentItem?.quizTitle || currentGroup?.items[0]?.quizTitle}
              </p>
            )}
          </div>

          <div className="text-sm font-bold min-w-[3rem] text-right text-[#1A1A1A]">
            {currentIndex + 1}/{totalCount}
          </div>
        </div>

        <div className="h-1.5 w-full bg-[#EDEAE4]">
          <motion.div
            className="h-full bg-[#1A1A1A]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
      </header>

      {/* 문제 영역 */}
      <main className="px-4 py-6 pb-40 overflow-y-auto overscroll-contain flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentGroup?.groupId || currentItem?.id || `group-${currentIndex}`}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
          >
            {/* 결합형 문제 */}
            {currentGroup?.isCombined ? (
              <div className="space-y-4">
                {/* 결합형 헤더 카드 */}
                <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base font-bold text-[#1A1A1A]">Q{currentIndex + 1}.</span>
                    <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                      결합형
                    </span>
                    <span className="px-2 py-0.5 bg-[#5C5C5C] text-[#F5F0E8] text-xs font-bold">
                      {currentGroup.items.length}문제
                    </span>
                  </div>

                  {/* 공통 문제 */}
                  {currentGroup.items[0]?.commonQuestion && (
                    <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap">
                      {currentGroup.items[0].commonQuestion}
                    </p>
                  )}

                  {/* 공통 지문 */}
                  {(currentGroup.items[0]?.passage || currentGroup.items[0]?.koreanAbcItems || currentGroup.items[0]?.passageMixedExamples) && (
                    <div className={`p-3 border border-[#8B6914] bg-[#FFF8E1] ${currentGroup.items[0]?.commonQuestion ? 'mt-3' : ''}`}>
                      {currentGroup.items[0].passage && currentGroup.items[0].passageType !== 'korean_abc' && currentGroup.items[0].passageType !== 'mixed' && (
                        <p className="text-xs text-[#1A1A1A]">{currentGroup.items[0].passage}</p>
                      )}
                      {currentGroup.items[0].passageType === 'korean_abc' && currentGroup.items[0].koreanAbcItems && (
                        <div className="space-y-1">
                          {currentGroup.items[0].koreanAbcItems.map((itm, i) => (
                            <p key={i} className="text-xs text-[#1A1A1A]">
                              <span className="font-bold">{KOREAN_LABELS[i]}.</span> {itm}
                            </p>
                          ))}
                        </div>
                      )}
                      {currentGroup.items[0].passageType === 'mixed' && currentGroup.items[0].passageMixedExamples && currentGroup.items[0].passageMixedExamples.length > 0 && (
                        <div className="space-y-2">
                          {currentGroup.items[0].passageMixedExamples.map((block: any) => (
                            <div key={block.id}>
                              {block.type === 'grouped' && (
                                <div className="space-y-1">
                                  {(block.children || []).map((child: any) => (
                                    <div key={child.id}>
                                      {child.type === 'text' && child.content?.trim() && (
                                        <p className="text-xs text-[#5C5C5C]">{child.content}</p>
                                      )}
                                      {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((it: any) => (
                                        <p key={it.id} className="text-xs text-[#1A1A1A]">
                                          <span className="font-bold mr-1">{it.label}.</span>
                                          {it.content}
                                        </p>
                                      ))}
                                      {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((it: any) => (
                                        <p key={it.id} className="text-xs text-[#1A1A1A]">
                                          <span className="font-bold mr-1">({it.label})</span>
                                          {it.content}
                                        </p>
                                      ))}
                                      {child.type === 'image' && child.imageUrl && (
                                        <img src={child.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {block.type === 'text' && block.content?.trim() && (
                                <p className="text-xs text-[#1A1A1A]">{block.content}</p>
                              )}
                              {block.type === 'labeled' && (block.items || []).length > 0 && (
                                <div className="space-y-1">
                                  {(block.items || []).filter((i: any) => i.content?.trim()).map((it: any) => (
                                    <p key={it.id} className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">{it.label}.</span>
                                      {it.content}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {block.type === 'gana' && (block.items || []).length > 0 && (
                                <div className="space-y-1">
                                  {(block.items || []).filter((i: any) => i.content?.trim()).map((it: any) => (
                                    <p key={it.id} className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">({it.label})</span>
                                      {it.content}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {block.type === 'image' && block.imageUrl && (
                                <img src={block.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 공통 이미지 */}
                  {currentGroup.items[0]?.passageImage && (
                    <div className="mt-3">
                      <img
                        src={currentGroup.items[0].passageImage}
                        alt="공통 이미지"
                        className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                      />
                    </div>
                  )}
                </div>

                {/* 하위 문제들 */}
                {currentGroup.items.map((subItem, subIdx) => {
                  const subAnswer = combinedAnswers[currentIndex]?.[subIdx] ?? null;
                  const subResult = combinedResultsMap[currentIndex]?.[subIdx];
                  const isSubCorrect = subResult?.isCorrect;
                  const isSubMultipleAnswer = subItem.correctAnswer?.toString().includes(',');

                  return (
                    <div key={subItem.id} className="bg-[#EDEAE4] border border-[#D4CFC4] p-3">
                      {/* 하위 문제 헤더 */}
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <span className="text-sm font-bold text-[#1A1A1A]">Q{currentIndex + 1}-{subIdx + 1}.</span>
                        <span className="px-2 py-0.5 bg-[#5C5C5C] text-[#F5F0E8] text-xs font-bold">
                          {typeLabels[subItem.type] || '문제'}
                        </span>
                        {isSubMultipleAnswer && (
                          <span className="px-2 py-0.5 bg-[#1A6B1A] text-[#F5F0E8] text-xs font-bold">
                            복수정답
                          </span>
                        )}
                        {isSubmitted && (
                          <span className={`px-2 py-0.5 text-xs font-bold ${
                            isSubCorrect ? 'bg-[#1A6B1A] text-white' : 'bg-[#8B1A1A] text-white'
                          }`}>
                            {isSubCorrect ? '정답' : '오답'}
                          </span>
                        )}
                        {userCourseId && subItem.chapterId && (
                          <span className="px-2 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                            {formatChapterLabel(userCourseId, subItem.chapterId, subItem.chapterDetailId)}
                          </span>
                        )}
                      </div>

                      {/* 하위 문제 텍스트 */}
                      <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap mb-3">
                        {subItem.question}
                      </p>

                      {/* 하위 문제 이미지 */}
                      {subItem.image && (
                        <div className="mb-3">
                          <img
                            src={subItem.image}
                            alt="문제 이미지"
                            className="max-w-full max-h-[200px] object-contain border border-[#1A1A1A]"
                          />
                        </div>
                      )}

                      {/* 지문 - 혼합 형식 (mixedExamples) */}
                      {subItem.mixedExamples && subItem.mixedExamples.length > 0 && (
                        <div className="space-y-2 mb-3">
                          <p className="text-xs font-bold text-[#8B6914]">지문</p>
                          {subItem.mixedExamples.map((block: any) => (
                            <div key={block.id}>
                              {block.type === 'grouped' && (block.children?.length ?? 0) > 0 && (
                                <div className="p-3 bg-[#FFF8E1] border-2 border-[#8B6914] space-y-1">
                                  {(block.children || []).map((child: any) => (
                                    <div key={child.id}>
                                      {child.type === 'text' && child.content?.trim() && (
                                        <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                                      )}
                                      {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                        <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">{itm.label}.</span>{itm.content}
                                        </p>
                                      ))}
                                      {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                        <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">({itm.label})</span>{itm.content}
                                        </p>
                                      ))}
                                      {child.type === 'image' && child.imageUrl && (
                                        <img src={child.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {block.type === 'text' && block.content?.trim() && (
                                <div className="p-3 bg-[#FFF8E1] border border-[#8B6914]">
                                  <p className="text-[#1A1A1A] text-xs whitespace-pre-wrap">{block.content}</p>
                                </div>
                              )}
                              {block.type === 'labeled' && (block.items || []).length > 0 && (
                                <div className="p-3 bg-[#FFF8E1] border border-[#8B6914] space-y-1">
                                  {(block.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                    <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                      <span className="font-bold mr-1">{itm.label}.</span>{itm.content}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {block.type === 'gana' && (block.items || []).length > 0 && (
                                <div className="p-3 bg-[#FFF8E1] border border-[#8B6914] space-y-1">
                                  {(block.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                    <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                      <span className="font-bold mr-1">({itm.label})</span>{itm.content}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {block.type === 'image' && block.imageUrl && (
                                <div className="border border-[#1A1A1A] overflow-hidden">
                                  <img src={block.imageUrl} alt="지문 이미지" className="max-w-full h-auto" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 지문 - 레거시 형식 (subQuestionOptions) */}
                      {!subItem.mixedExamples && subItem.subQuestionOptions && subItem.subQuestionOptions.length > 0 && (
                        <div className="p-3 border border-[#8B6914] bg-[#FFF8E1] mb-3">
                          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                          {subItem.subQuestionOptionsType === 'text' ? (
                            <p className="text-xs text-[#1A1A1A]">
                              {subItem.subQuestionOptions.join(', ')}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {subItem.subQuestionOptions.map((opt, i) => (
                                <p key={i} className="text-xs text-[#1A1A1A]">
                                  <span className="font-bold">{KOREAN_LABELS[i]}.</span> {opt}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 선지 영역 */}
                      <div>
                        {subItem.type === 'ox' && (
                          <OXChoice
                            selected={subAnswer as OXAnswer}
                            onSelect={(value) => !isSubmitted && setCombinedAnswer(subIdx, value)}
                            disabled={isSubmitted}
                          />
                        )}

                        {subItem.type === 'multiple' && subItem.options && (
                          isSubMultipleAnswer ? (
                            <MultipleChoice
                              choices={subItem.options}
                              multiSelect
                              selectedIndices={Array.isArray(subAnswer) ? subAnswer : []}
                              onMultiSelect={(indices) => !isSubmitted && setCombinedAnswer(subIdx, indices)}
                              disabled={isSubmitted}
                              correctIndices={
                                isSubmitted
                                  ? subItem.correctAnswer.toString().split(',').map(s => parseInt(s.trim(), 10) - 1)
                                  : undefined
                              }
                            />
                          ) : (
                            <MultipleChoice
                              choices={subItem.options}
                              selected={typeof subAnswer === 'number' ? subAnswer : null}
                              onSelect={(index) => !isSubmitted && setCombinedAnswer(subIdx, index)}
                              disabled={isSubmitted}
                              correctIndex={
                                isSubmitted
                                  ? parseInt(subItem.correctAnswer.toString(), 10) - 1
                                  : undefined
                              }
                            />
                          )
                        )}

                        {(subItem.type === 'short' || subItem.type === 'short_answer' || subItem.type === 'subjective') && (
                          <ShortAnswer
                            value={(subAnswer as string) || ''}
                            onChange={(value) => !isSubmitted && setCombinedAnswer(subIdx, value)}
                            disabled={isSubmitted}
                          />
                        )}
                      </div>

                      {/* 제출 후 피드백 */}
                      {isSubmitted && (
                        <div className="mt-2 space-y-2">
                          {/* 정답/오답 상태 */}
                          <div className={`p-3 border-2 ${
                            isSubCorrect
                              ? 'border-[#1A6B1A] bg-[#E8F5E9]'
                              : 'border-[#8B1A1A] bg-[#FDEAEA]'
                          }`}>
                            <p className={`text-base font-bold text-center ${
                              isSubCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                            }`}>
                              {isSubCorrect ? '정답입니다!' : '오답입니다'}
                            </p>
                            {!isSubCorrect && (
                              <p className="text-sm text-center text-[#8B1A1A] mt-1">
                                <span>정답: </span>
                                <span className="font-bold">
                                  {subItem.type === 'ox'
                                    ? (subItem.correctAnswer?.toString() === '0' || subItem.correctAnswer?.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                    : subItem.type === 'multiple'
                                    ? subItem.correctAnswer?.toString().split(',').map(a => `${a.trim()}번`).join(', ')
                                    : subItem.correctAnswer?.toString()}
                                </span>
                              </p>
                            )}
                          </div>

                          {/* 해설 */}
                          <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A]">
                            <p className="text-xs font-bold text-[#5C5C5C]">해설</p>
                            <p className="text-xs text-[#1A1A1A]">
                              {subItem.explanation || '해설이 없습니다.'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : currentItem && (
              /* 단일 문제 */
              <>
                {/* 문제 카드 */}
                <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="text-base font-bold text-[#1A1A1A]">Q{currentIndex + 1}.</span>
                    <span className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                      {typeLabels[currentItem.type] || '문제'}
                    </span>
                    {isMultipleAnswerQuestion() && (
                      <span className="px-2 py-0.5 bg-[#1A6B1A] text-[#F5F0E8] text-xs font-bold">
                        복수정답
                      </span>
                    )}
                    {userCourseId && currentItem.chapterId && (
                      <span className="px-2 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                        {formatChapterLabel(userCourseId, currentItem.chapterId, currentItem.chapterDetailId)}
                      </span>
                    )}
                  </div>
                  <p className="text-[#1A1A1A] text-sm leading-relaxed whitespace-pre-wrap">
                    {currentItem.question}
                  </p>
                  {/* 문제 이미지 */}
                  {currentItem.image && (
                    <div className="mt-4">
                      <img
                        src={currentItem.image}
                        alt="문제 이미지"
                        className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                      />
                    </div>
                  )}
                  {/* AI 크롭 이미지 (HARD 난이도 문제) */}
                  {currentItem.imageUrl && (
                    <div className="mt-4">
                      <img
                        src={currentItem.imageUrl}
                        alt="문제 관련 자료"
                        className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                      />
                    </div>
                  )}

                  {/* 지문 - 혼합 형식 (mixedExamples) */}
                  {currentItem.mixedExamples && currentItem.mixedExamples.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-bold text-[#8B6914]">지문</p>
                      {currentItem.mixedExamples.map((block: any) => (
                        <div key={block.id}>
                          {block.type === 'grouped' && (block.children?.length ?? 0) > 0 && (
                            <div className="p-3 bg-[#FFF8E1] border-2 border-[#8B6914] space-y-1">
                              {(block.children || []).map((child: any) => (
                                <div key={child.id}>
                                  {child.type === 'text' && child.content?.trim() && (
                                    <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                                  )}
                                  {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                    <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                      <span className="font-bold mr-1">{itm.label}.</span>{itm.content}
                                    </p>
                                  ))}
                                  {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                    <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                      <span className="font-bold mr-1">({itm.label})</span>{itm.content}
                                    </p>
                                  ))}
                                  {child.type === 'image' && child.imageUrl && (
                                    <img src={child.imageUrl} alt="지문 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {block.type === 'text' && block.content?.trim() && (
                            <div className="p-3 bg-[#FFF8E1] border border-[#8B6914]">
                              <p className="text-[#1A1A1A] text-xs whitespace-pre-wrap">{block.content}</p>
                            </div>
                          )}
                          {block.type === 'labeled' && (block.items || []).length > 0 && (
                            <div className="p-3 bg-[#FFF8E1] border border-[#8B6914] space-y-1">
                              {(block.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                  <span className="font-bold mr-1">{itm.label}.</span>{itm.content}
                                </p>
                              ))}
                            </div>
                          )}
                          {block.type === 'gana' && (block.items || []).length > 0 && (
                            <div className="p-3 bg-[#FFF8E1] border border-[#8B6914] space-y-1">
                              {(block.items || []).filter((i: any) => i.content?.trim()).map((itm: any) => (
                                <p key={itm.id} className="text-[#1A1A1A] text-xs">
                                  <span className="font-bold mr-1">({itm.label})</span>{itm.content}
                                </p>
                              ))}
                            </div>
                          )}
                          {block.type === 'image' && block.imageUrl && (
                            <div className="border border-[#1A1A1A] overflow-hidden">
                              <img src={block.imageUrl} alt="지문 이미지" className="max-w-full h-auto" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 지문 - 레거시 형식 (subQuestionOptions) */}
                  {!currentItem.mixedExamples && currentItem.subQuestionOptions && currentItem.subQuestionOptions.length > 0 && (
                    <div className="mt-4 p-3 border border-[#8B6914] bg-[#FFF8E1]">
                      <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                      {currentItem.subQuestionOptionsType === 'text' ? (
                        <p className="text-xs text-[#1A1A1A]">
                          {currentItem.subQuestionOptions.join(', ')}
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {currentItem.subQuestionOptions.map((opt, i) => (
                            <p key={i} className="text-xs text-[#1A1A1A]">
                              <span className="font-bold">{KOREAN_LABELS[i]}.</span> {opt}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 선지 영역 */}
                <div className="mt-4">
                  {currentItem.type === 'ox' && (
                    <OXChoice
                      selected={answer as OXAnswer}
                      onSelect={(value) => !isSubmitted && setAnswer(value)}
                      disabled={isSubmitted}
                    />
                  )}

                  {currentItem.type === 'multiple' && currentItem.options && (
                    isMultipleAnswerQuestion() ? (
                      <MultipleChoice
                        choices={currentItem.options}
                        multiSelect
                        selectedIndices={Array.isArray(answer) ? answer : []}
                        onMultiSelect={(indices) => !isSubmitted && setAnswer(indices)}
                        disabled={isSubmitted}
                        correctIndices={
                          isSubmitted
                            ? currentItem.correctAnswer.toString().split(',').map(s => parseInt(s.trim(), 10) - 1)
                            : undefined
                        }
                      />
                    ) : (
                      <MultipleChoice
                        choices={currentItem.options}
                        selected={typeof answer === 'number' ? answer : null}
                        onSelect={(index) => !isSubmitted && setAnswer(index)}
                        disabled={isSubmitted}
                        correctIndex={
                          isSubmitted
                            ? parseInt(currentItem.correctAnswer.toString(), 10) - 1
                            : undefined
                        }
                      />
                    )
                  )}

                  {(currentItem.type === 'short' || currentItem.type === 'short_answer' || currentItem.type === 'subjective') && (
                    <ShortAnswer
                      value={(answer as string) || ''}
                      onChange={(value) => !isSubmitted && setAnswer(value)}
                      disabled={isSubmitted}
                    />
                  )}

                  {/* 서술형 입력 */}
                  {currentItem.type === 'essay' && (
                    <ShortAnswer
                      value={(answer as string) || ''}
                      onChange={(value) => !isSubmitted && setAnswer(value)}
                      disabled={isSubmitted}
                      maxLength={200}
                      placeholder="아는 것을 200자 내로 적어주세요."
                    />
              )}
            </div>

            {/* 제출 후 결과 표시 */}
            <AnimatePresence>
              {isSubmitted && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="mt-6"
                >
                  {currentItem?.type === 'essay' ? (
                    // 서술형: 채점 없이 수고하셨습니다 표시
                    <div className="p-3 text-center border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                      <p className="text-lg font-bold text-[#1A1A1A]">
                        수고하셨습니다.
                      </p>
                    </div>
                  ) : (
                  <div
                    className={`p-3 text-center border-2 ${
                      isCorrect
                        ? 'bg-[#E8F5E9] border-[#1A6B1A]'
                        : 'bg-[#FDEAEA] border-[#8B1A1A]'
                    }`}
                  >
                    <p className={`text-lg font-bold ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                      {isCorrect ? '정답입니다!' : '오답입니다'}
                    </p>

                    {!isCorrect && (
                      <div className="mt-2 text-xs text-[#5C5C5C]">
                        {currentItem.type === 'multiple' && currentItem.options && currentItem.correctAnswer.toString().includes(',') ? (
                          <>
                            <div className="mb-1">
                              <span>내 답: </span>
                              <span className="font-bold text-[#8B1A1A]">
                                {(() => {
                                  const userAnswerStr = resultsMap[currentIndex]?.userAnswer || '';
                                  if (!userAnswerStr) return '(미응답)';
                                  const userIndices = userAnswerStr.split(',').map(s => parseInt(s.trim(), 10) + 1);
                                  return userIndices.map(n => `${n}번`).join(', ');
                                })()}
                              </span>
                            </div>
                            <div>
                              <span>정답: </span>
                              <span className="font-bold text-[#1A6B1A]">
                                {currentItem.correctAnswer
                                  ? currentItem.correctAnswer.toString().split(',').map((ans: string) => `${ans.trim()}번`).join(', ')
                                  : '(정답 정보 없음)'}
                              </span>
                            </div>
                          </>
                        ) : currentItem.type === 'multiple' && currentItem.options ? (
                          <>
                            <div className="mb-1">
                              <span>내 답: </span>
                              <span className="font-bold text-[#8B1A1A]">
                                {(() => {
                                  const userAnswerStr = resultsMap[currentIndex]?.userAnswer || '';
                                  if (!userAnswerStr) return '(미응답)';
                                  const userIdx = parseInt(userAnswerStr, 10) + 1;
                                  return `${userIdx}번`;
                                })()}
                              </span>
                            </div>
                            <div>
                              <span>정답: </span>
                              <span className="font-bold text-[#1A6B1A]">
                                {currentItem.correctAnswer && currentItem.correctAnswer.toString().trim() !== ''
                                  ? `${currentItem.correctAnswer.toString()}번`
                                  : '(정답 정보 없음)'}
                              </span>
                            </div>
                          </>
                        ) : currentItem.correctAnswer && currentItem.correctAnswer.toString().includes('|||') ? (
                          <>
                            <span>정답 (다음 중 하나): </span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {currentItem.correctAnswer.toString().split('|||').map((ans: string, idx: number) => (
                                <span key={idx} className="px-2 py-0.5 bg-[#E8F5E9] border border-[#1A6B1A] text-[#1A6B1A] font-bold">
                                  {ans.trim()}
                                </span>
                              ))}
                            </div>
                          </>
                        ) : currentItem.type === 'ox' ? (
                          <>
                            <span>정답: </span>
                            <span className="font-bold text-[#1A6B1A]">
                              {currentItem.correctAnswer !== undefined && currentItem.correctAnswer !== null
                                ? (currentItem.correctAnswer.toString() === '0' || currentItem.correctAnswer.toString().toUpperCase() === 'O' ? 'O' : 'X')
                                : '(정답 정보 없음)'}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>정답: </span>
                            <span className="font-bold text-[#1A6B1A]">
                              {currentItem.correctAnswer && currentItem.correctAnswer.toString().trim() !== ''
                                ? currentItem.correctAnswer.toString()
                                : '(정답 정보 없음)'}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {currentItem.type !== 'essay' && currentItem.explanation && (
                    <div className="mt-4 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                      <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                      <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap">{currentItem.explanation}</p>
                    </div>
                  )}

                  {/* AI 생성 문제 - 선지별 해설 아코디언 */}
                  {currentItem.choiceExplanations && currentItem.type === 'multiple' && currentItem.options && currentItem.options.length > 0 && (
                    <div className="mt-3 border border-[#D4CFC4] bg-[#FAFAF8]">
                      <p className="px-3 py-2 text-xs font-bold text-[#5C5C5C] border-b border-[#D4CFC4]">
                        선지별 해설
                      </p>
                      <div className="divide-y divide-[#EDEAE4]">
                        {currentItem.options.map((opt, idx) => {
                          const choiceExp = currentItem.choiceExplanations?.[idx];
                          if (!choiceExp) return null;
                          const choiceKey = `${currentIndex}-${idx}`;
                          const isChoiceExpanded = expandedChoiceExplanations.has(choiceKey);
                          const correctAnswerStr = currentItem.correctAnswer?.toString() || '';
                          const correctAnswers = correctAnswerStr.includes(',')
                            ? correctAnswerStr.split(',').map(a => a.trim())
                            : [correctAnswerStr];
                          const isCorrectChoice = correctAnswers.includes((idx + 1).toString());

                          return (
                            <button
                              key={idx}
                              onClick={() => {
                                setExpandedChoiceExplanations(prev => {
                                  const next = new Set(prev);
                                  if (next.has(choiceKey)) {
                                    next.delete(choiceKey);
                                  } else {
                                    next.add(choiceKey);
                                  }
                                  return next;
                                });
                              }}
                              className="w-full text-left"
                            >
                              <div className="px-3 py-2 flex items-center gap-2">
                                <span className={`flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs font-bold ${
                                  isCorrectChoice
                                    ? 'bg-[#1A6B1A] text-white'
                                    : 'bg-[#EDEAE4] text-[#5C5C5C]'
                                }`}>
                                  {idx + 1}
                                </span>
                                <span className="flex-1 text-sm text-[#1A1A1A] truncate">{opt}</span>
                                <svg
                                  className={`w-4 h-4 text-[#5C5C5C] transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </div>
                              <AnimatePresence>
                                {isChoiceExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="px-3 pb-3 pt-1">
                                      <p className="text-sm text-[#5C5C5C] bg-[#EDEAE4] p-2 border-l-2 border-[#8B6914]">
                                        {choiceExp.replace(/^선지\s*\d+\s*해설\s*[:：]\s*/i, '')}
                                      </p>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 하단 버튼 */}
      <div
        className="fixed bottom-0 left-0 right-0 p-4 border-t-2 border-[#1A1A1A]"
        style={{ backgroundColor: '#F5F0E8' }}
      >
        <div className="flex gap-3">
          {currentIndex > 0 && (
            <button
              onClick={handlePrev}
              className="flex-1 py-3 bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
            >
              이전
            </button>
          )}

          {!isSubmitted ? (
            <button
              onClick={handleSubmit}
              className={`${currentIndex > 0 ? 'flex-[2]' : 'w-full'} py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg`}
            >
              제출하기
            </button>
          ) : (
            <button
              onClick={handleNext}
              className={`${currentIndex > 0 ? 'flex-[2]' : 'w-full'} py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg`}
            >
              {isLastQuestion ? '결과 보기' : '다음 문제'}
            </button>
          )}
        </div>
      </div>

      {/* 나가기 확인 모달 */}
      <ExitConfirmModal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        onSaveAndExit={() => {
          setShowExitModal(false);
          onClose();
        }}
        onExitWithoutSave={() => {
          setShowExitModal(false);
          onClose();
        }}
        answeredCount={submittedIndices.size}
        totalQuestions={items.length}
      />
    </motion.div>
  );
}
