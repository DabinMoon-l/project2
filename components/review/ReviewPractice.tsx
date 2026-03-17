'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { collection, addDoc, serverTimestamp, doc, getDoc, db } from '@/lib/repositories';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import type { ReviewItem } from '@/lib/hooks/useReview';
import { useReview } from '@/lib/hooks/useReview';
import { getChapterById } from '@/lib/courseIndex';
import { useExpToast } from '@/components/common';
import { EXP_REWARDS } from '@/lib/utils/expRewards';
import ExitConfirmModal from '@/components/quiz/ExitConfirmModal';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { type FeedbackType } from '@/components/review/types';
import type { ReviewPracticeProps, PracticeResult, AnswerType, Phase } from './reviewPracticeTypes';
import { TYPE_LABELS } from './reviewPracticeTypes';
import { checkSingleAnswer } from './reviewPracticeUtils';
import ResultStage from './stages/ResultStage';
import FeedbackStage from './stages/FeedbackStage';
import PracticeStage from './stages/PracticeStage';
export type { PracticeResult } from './reviewPracticeTypes';

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
  // 완료 처리 중 (중복 클릭 방지)
  const [isFinishing, setIsFinishing] = useState(false);
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
  const [selectedFeedbackTypes, setSelectedFeedbackTypes] = useState<Set<FeedbackType>>(new Set());
  const [feedbackContent, setFeedbackContent] = useState('');
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [isFeedbackDone, setIsFeedbackDone] = useState(false);
  const [submittedFeedbackIds, setSubmittedFeedbackIds] = useState<Set<string>>(new Set());
  // 피드백 제출 횟수 (완료 시 합산 EXP 토스트용)
  const [feedbackSubmitCount, setFeedbackSubmitCount] = useState(0);

  // 인라인 피드백 (풀이 중 피드백)
  const [inlineFeedbackOpen, setInlineFeedbackOpen] = useState<string | null>(null);

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

  const typeLabels = TYPE_LABELS;

  // 복수 정답 여부 확인
  const isMultipleAnswerQuestion = useCallback(() => {
    if (!currentItem) return false;
    const correctAnswerStr = currentItem.correctAnswer?.toString() || '';
    return correctAnswerStr.includes(',');
  }, [currentItem]);

  // 현재 단일 문제 정답 체크
  const checkAnswer = useCallback(() => {
    if (!currentItem || answer === null) return false;
    return checkSingleAnswer(currentItem, answer);
  }, [currentItem, answer]);

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
  const handleFinish = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    const revExp = correctCount * 2;
    const fbExp = feedbackSubmitCount * EXP_REWARDS.FEEDBACK_SUBMIT;
    const totalExp = revExp + fbExp;
    if (totalExp > 0) {
      const parts: string[] = [];
      if (revExp > 0) parts.push(`복습 ${revExp}`);
      if (fbExp > 0) parts.push(`피드백 ${fbExp}`);
      showExpToast(totalExp, parts.join(' + '));
    }
    await onComplete(resultsArray);
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
    setSelectedFeedbackTypes(new Set());
    setFeedbackContent('');
    setIsFeedbackDone(false);
  };

  // 피드백 타입 토글
  const toggleFeedbackType = (type: FeedbackType) => {
    setSelectedFeedbackTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // 피드백 제출
  const handleFeedbackSubmit = async () => {
    if (!feedbackTargetItem || selectedFeedbackTypes.size === 0 || !user) return;
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
      const types = Array.from(selectedFeedbackTypes);
      await Promise.all(types.map(type =>
        addDoc(feedbackRef, {
          questionId: feedbackTargetItem.questionId,
          quizId: feedbackTargetItem.quizId,
          quizCreatorId: creatorId,
          userId: user.uid,
          questionNumber,
          type,
          content: feedbackContent,
          createdAt: serverTimestamp(),
        })
      ));
      setSubmittedFeedbackIds(prev => new Set(prev).add(feedbackTargetItem.questionId));
      setFeedbackSubmitCount(prev => prev + 1);
      setIsFeedbackDone(true);
      setTimeout(() => {
        closeFeedbackSheet();
      }, 800);
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

  // 복습 EXP 계산 (정답당 2 EXP)
  const reviewExp = correctCount * 2;
  // 피드백 EXP 계산
  const feedbackExp = feedbackSubmitCount * EXP_REWARDS.FEEDBACK_SUBMIT;
  // 총 획득 EXP (복습 + 피드백)
  const totalDisplayExp = reviewExp + feedbackExp;

  // ========== 결과 화면 ==========
  if (phase === 'result') {
    return (
      <ResultStage
        groupedItems={groupedItems}
        resultsMap={resultsMap}
        combinedResultsMap={combinedResultsMap}
        correctCount={correctCount}
        totalQuestionCount={totalQuestionCount}
        headerTitle={headerTitle}
        showFeedback={showFeedback}
        userCourseId={userCourseId}
        currentUserId={currentUserId}
        expandedIds={expandedIds}
        toggleExpand={toggleExpand}
        expandedSubIds={expandedSubIds}
        toggleSubExpand={toggleSubExpand}
        expandedChoiceExplanations={expandedChoiceExplanations}
        setExpandedChoiceExplanations={setExpandedChoiceExplanations}
        submittedFeedbackIds={submittedFeedbackIds}
        openFeedbackSheet={openFeedbackSheet}
        feedbackTargetItem={feedbackTargetItem}
        closeFeedbackSheet={closeFeedbackSheet}
        selectedFeedbackTypes={selectedFeedbackTypes}
        toggleFeedbackType={toggleFeedbackType}
        feedbackContent={feedbackContent}
        setFeedbackContent={setFeedbackContent}
        isFeedbackSubmitting={isFeedbackSubmitting}
        isFeedbackDone={isFeedbackDone}
        handleFeedbackSubmit={handleFeedbackSubmit}
        onGoToFeedback={handleGoToFeedback}
        onBackToPractice={() => setPhase('practice')}
      />
    );
  }

  // ========== 피드백 화면 ==========
  if (phase === 'feedback') {
    return (
      <FeedbackStage
        wrongItems={wrongItems}
        correctCount={correctCount}
        totalQuestionCount={totalQuestionCount}
        headerTitle={headerTitle}
        chapterGroupedWrongItems={chapterGroupedWrongItems}
        totalDisplayExp={totalDisplayExp}
        customFolders={customFolders}
        selectedFolderId={selectedFolderId}
        setSelectedFolderId={setSelectedFolderId}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        isCreatingFolder={isCreatingFolder}
        handleCreateFolder={handleCreateFolder}
        isSaving={isSaving}
        handleSaveToFolder={handleSaveToFolder}
        saveSuccess={saveSuccess}
        onBackToResult={() => setPhase('result')}
        onFinish={handleFinish}
        isFinishing={isFinishing}
      />
    );
  }

  // ========== 문제 풀이 화면 ==========
  return (
    <>
      <PracticeStage
        groupedItems={groupedItems}
        currentIndex={currentIndex}
        totalCount={totalCount}
        currentGroup={currentGroup}
        currentItem={currentItem ?? null}
        progress={progress}
        headerTitle={headerTitle}
        quizTitle={quizTitle}
        userCourseId={userCourseId}
        typeLabels={typeLabels}
        answers={answers}
        combinedAnswers={combinedAnswers}
        answer={answer}
        isSubmitted={isSubmitted}
        isCorrect={!!isCorrect}
        isLastQuestion={isLastQuestion}
        resultsMap={resultsMap}
        combinedResultsMap={combinedResultsMap}
        setAnswer={setAnswer}
        setCombinedAnswer={setCombinedAnswer}
        isMultipleAnswerQuestion={isMultipleAnswerQuestion}
        handleSubmit={handleSubmit}
        handleNext={handleNext}
        handlePrev={handlePrev}
        onClose={onClose}
        expandedChoiceExplanations={expandedChoiceExplanations}
        setExpandedChoiceExplanations={setExpandedChoiceExplanations}
        inlineFeedbackOpen={inlineFeedbackOpen}
        setInlineFeedbackOpen={setInlineFeedbackOpen}
        submittedFeedbackIds={submittedFeedbackIds}
        setSubmittedFeedbackIds={setSubmittedFeedbackIds}
        feedbackSubmitCount={feedbackSubmitCount}
        setFeedbackSubmitCount={setFeedbackSubmitCount}
        user={user}
      />

      {/* 나가기 확인 모달 (부모에 유지) */}
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
    </>
  );
}
