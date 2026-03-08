'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '@/lib/hooks/useAuth';
import { useReview, calculateCustomFolderQuestionCount, type ReviewItem, type FolderCategory, type CustomFolderQuestion } from '@/lib/hooks/useReview';
import { useCourse } from '@/lib/contexts/CourseContext';
import dynamic from 'next/dynamic';
import { Skeleton, BottomSheet, useExpToast } from '@/components/common';
import type { PracticeResult } from '@/components/review/ReviewPractice';

// 대형 컴포넌트 lazy load (2,513줄 — 복습 풀이 시에만 로드)
const ReviewPractice = dynamic(() => import('@/components/review/ReviewPractice'), { ssr: false });
import { formatChapterLabel, getChapterById } from '@/lib/courseIndex';
import { useHideNav } from '@/lib/hooks/useHideNav';
import { type FeedbackType, type DisplayItem, type ReviewFilter } from '@/components/review/types';
import { KOREAN_LABELS, parseQuestionId, sortByQuestionId, createDisplayItems } from '@/lib/utils/reviewQuestionUtils';
import QuestionCard from '@/components/review/QuestionCard';
import AddQuestionsView from '@/components/review/AddQuestionsView';

/**
 * 폴더 상세 페이지
 */
export default function FolderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { userCourse, userClassId } = useCourse();
  const { showExpToast } = useExpToast();

  const folderType = params.type as string; // solved, wrong, bookmark, custom
  const folderId = params.id as string;

  // 최초 진입 시에만 슬라이드 애니메이션 (뒤로가기 시 재발동 방지)
  const [slideIn] = useState(() => {
    if (typeof window === 'undefined') return false;
    const key = `visited_review_${params.id}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  });
  const chapterFilter = searchParams.get('chapter'); // 챕터 필터 (오답 탭에서 챕터별 클릭 시)
  const fromQuizPage = searchParams.get('from') === 'quiz'; // 퀴즈 페이지 복습탭에서 접근 시 수정 비활성화
  const autoStart = searchParams.get('autoStart'); // 'all' | 'wrongOnly' — 퀴즈 페이지에서 바로 복습 시작

  // 과목별 리본 이미지 (solved 타입 또는 퀴즈 페이지에서 온 경우 퀴즈 리본, 나머지는 리뷰 리본)
  const ribbonImage = (folderType === 'solved' || fromQuizPage)
    ? (userCourse?.quizRibbonImage || '/images/biology-quiz-ribbon.png')
    : (userCourse?.reviewRibbonImage || '/images/biology-review-ribbon.png');
  const ribbonScale = (folderType === 'solved' || fromQuizPage)
    ? (userCourse?.quizRibbonScale || 1)
    : (userCourse?.reviewRibbonScale || 1);

  const {
    groupedSolvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    customFolders,
    solvedItems,
    wrongItems,
    addToCustomFolder,
    removeFromCustomFolder,
    deleteReviewItem,
    deleteCustomFolder,
    addCategoryToFolder,
    removeCategoryFromFolder,
    assignQuestionToCategory,
    loading: reviewLoading,
    markAsReviewed,
  } = useReview();

  const [customQuestions, setCustomQuestions] = useState<ReviewItem[]>([]);
  const [customLoading, setCustomLoading] = useState(false);
  // 서재(library) 퀴즈 상태
  const [libraryQuestions, setLibraryQuestions] = useState<ReviewItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  // 찜 퀴즈 폴백 상태 (reviews에 bookmark 타입 문제가 없을 때 퀴즈 문서에서 로드)
  const [bookmarkFallbackQuestions, setBookmarkFallbackQuestions] = useState<ReviewItem[]>([]);
  const [bookmarkFallbackLoading, setBookmarkFallbackLoading] = useState(false);
  const [bookmarkFallbackTitle, setBookmarkFallbackTitle] = useState('');
  const [libraryQuizTitle, setLibraryQuizTitle] = useState<string>('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  const [practiceMode, setPracticeMode] = useState<'all' | 'wrongOnly' | null>(null); // 복습 모드 (첫복습점수 저장용)
  const practiceModeRef = useRef<'all' | 'wrongOnly' | null>(null);
  // practiceMode 변경 시 ref 동기화 (useCallback 클로저 문제 방지)
  useEffect(() => { practiceModeRef.current = practiceMode; }, [practiceMode]);
  const [isAddMode, setIsAddMode] = useState(false);
  const [showEmptyMessage, setShowEmptyMessage] = useState(false);

  // 폴더/서재 삭제 모달 상태
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // 토스트 메시지 상태
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 토스트 표시 함수
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  };

  // 결합형 그룹 펼침 상태
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // 퀴즈별 생성자 ID 맵 (자기 문제 피드백 방지용)
  const [quizCreatorsMap, setQuizCreatorsMap] = useState<Map<string, string>>(new Map());
  // 퀴즈별 AI 생성 여부 맵 (AI 문제 피드백 방지용)
  const [quizAiMap, setQuizAiMap] = useState<Map<string, boolean>>(new Map());

  // 카테고리 관련 상태
  const [isCategoryMode, setIsCategoryMode] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [selectedCategoryForAssign, setSelectedCategoryForAssign] = useState<string | null>(null);

  // 퀴즈 점수 상태 (solved/bookmark 타입용)
  const [quizScores, setQuizScores] = useState<{ myScore?: number; myFirstReviewScore?: number; averageScore?: number; isPublic?: boolean } | null>(null);

  // 수정된 문제 ID 집합 (문제별 뱃지 표시용)
  const [updatedQuestionIds, setUpdatedQuestionIds] = useState<Set<string>>(new Set());

  // 수정 모드 상태 (제목 + 문제 인라인 수정)
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedQuestions, setEditedQuestions] = useState<Record<string, { question?: string; options?: string[]; explanation?: string; choiceExplanations?: string[] }>>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const loadedFolderRef = useRef<string | null>(null);
  const supplementedExpsRef = useRef<string | null>(null);

  // 네비게이션 숨김
  useHideNav(true);

  // 커스텀 폴더 찾기
  const customFolder = useMemo(() => {
    if (folderType === 'custom') {
      return customFolders.find(f => f.id === folderId) || null;
    }
    return null;
  }, [folderType, folderId, customFolders]);

  // 폴더 데이터 계산 (useMemo로 무한 루프 방지)
  const folderData = useMemo(() => {
    if (folderType === 'library') {
      // 서재 타입: 비동기로 로드됨
      return libraryQuizTitle ? { title: libraryQuizTitle, items: libraryQuestions } : null;
    } else if (folderType === 'solved') {
      const group = groupedSolvedItems.find(g => g.quizId === folderId);
      return group ? { title: group.quizTitle, items: group.items } : null;
    } else if (folderType === 'wrong') {
      const group = groupedWrongItems.find(g => g.quizId === folderId);
      if (!group) return null;
      // 챕터 필터가 있으면 해당 챕터의 문제만 필터링
      const filteredItems = chapterFilter
        ? group.items.filter(item => item.chapterId === chapterFilter)
        : group.items;
      return { title: group.quizTitle, items: filteredItems };
    } else if (folderType === 'bookmark') {
      // 1) bookmark 리뷰에서 찾기 (개별 문제 찜)
      const bookmarkGroup = groupedBookmarkedItems.find(g => g.quizId === folderId);
      if (bookmarkGroup) return { title: bookmarkGroup.quizTitle, items: bookmarkGroup.items };
      // 2) solved 리뷰에서 폴백 (퀴즈 레벨만 찜한 경우, 풀이 기록이 있으면 사용)
      const solvedGroup = groupedSolvedItems.find(g => g.quizId === folderId);
      if (solvedGroup) return { title: solvedGroup.quizTitle, items: solvedGroup.items };
      // 3) 퀴즈 문서에서 직접 로드한 폴백 데이터
      if (bookmarkFallbackTitle) return { title: bookmarkFallbackTitle, items: bookmarkFallbackQuestions };
      return null;
    } else if (folderType === 'custom' && customFolder) {
      return { title: customFolder.name, items: null as ReviewItem[] | null };
    }
    return null;
  }, [folderType, folderId, groupedSolvedItems, groupedWrongItems, groupedBookmarkedItems, customFolder, chapterFilter, libraryQuizTitle, libraryQuestions, bookmarkFallbackTitle, bookmarkFallbackQuestions]);

  // 비서재 타입(wrong/solved/bookmark)에서 choiceExplanations가 빠진 경우 퀴즈 문서에서 보충
  useEffect(() => {
    if (!user || folderType === 'library') return;
    if (!folderData?.items || folderData.items.length === 0) return;
    if (supplementedExpsRef.current === folderId) return;

    const hasMissing = folderData.items.some(
      item => !item.choiceExplanations && item.type === 'multiple'
    );
    if (!hasMissing) return;

    const supplementExps = async () => {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) return;
        const questions = quizDoc.data().questions || [];
        const expsMap: Record<string, string[]> = {};
        questions.forEach((q: any, idx: number) => {
          if (q.choiceExplanations?.length > 0) {
            expsMap[q.id || `q${idx}`] = q.choiceExplanations;
            expsMap[(idx + 1).toString()] = q.choiceExplanations;
          }
        });

        let changed = false;
        folderData.items?.forEach(item => {
          if (!item.choiceExplanations && item.type === 'multiple') {
            const exps = expsMap[item.questionId] || expsMap[item.questionId?.replace(/^q/, '')];
            if (exps) {
              item.choiceExplanations = exps;
              changed = true;
            }
          }
        });

        if (changed) {
          supplementedExpsRef.current = folderId;
          setUpdatedQuestionIds(prev => new Set(prev));
        }
      } catch (e) {
        console.error('choiceExplanations 보충 오류:', e);
      }
    };

    supplementExps();
  }, [user, folderType, folderId, folderData]);

  // 커스텀 폴더일 때만 비동기로 문제 로드
  useEffect(() => {
    if (!user || folderType !== 'custom' || !customFolder) return;
    if (loadedFolderRef.current === folderId) return;

    const loadCustomQuestions = async () => {
      setCustomLoading(true);

      // quizId별로 questionId 그룹화 (in 쿼리 일괄 조회용)
      const quizGroups = new Map<string, string[]>();
      for (const q of customFolder.questions) {
        const ids = quizGroups.get(q.quizId) || [];
        ids.push(q.questionId);
        quizGroups.set(q.quizId, ids);
      }

      // quizId별로 병렬 일괄 쿼리 (in 쿼리 최대 30개씩)
      const batchPromises: Promise<ReviewItem[]>[] = [];
      for (const [quizId, questionIds] of quizGroups) {
        for (let i = 0; i < questionIds.length; i += 30) {
          const batch = questionIds.slice(i, i + 30);
          batchPromises.push((async () => {
            const snap = await getDocs(query(
              collection(db, 'reviews'),
              where('userId', '==', user.uid),
              where('quizId', '==', quizId),
              where('questionId', 'in', batch),
              where('reviewType', '==', 'solved')
            ));
            return snap.docs.map(d => {
              const data = d.data();
              return {
                id: d.id,
                ...data,
                reviewCount: data.reviewCount || 0,
              } as ReviewItem;
            });
          })());
        }
      }

      const results = await Promise.all(batchPromises);
      const items = results.flat();

      // questionId 기준으로 정렬 (결합형 문제 순서 유지)
      setCustomQuestions(sortByQuestionId(items));
      loadedFolderRef.current = folderId;
      setCustomLoading(false);
    };

    loadCustomQuestions();
  }, [user, folderType, folderId, customFolder]);

  // 서재(library) 퀴즈 로드
  useEffect(() => {
    if (!user || folderType !== 'library') return;

    const loadLibraryQuiz = async () => {
      setLibraryLoading(true);
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));

        // quizResults에서 사용자 풀이 결과 가져오기
        const resultQuery = query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid),
          where('quizId', '==', folderId)
        );
        const resultDocs = await getDocs(resultQuery);

        // 가장 최근 결과의 questionScores 가져오기
        let questionScores: Record<string, any> = {};
        if (!resultDocs.empty) {
          const sorted = resultDocs.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis?.() || 0;
            const bTime = b.data().createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });
          questionScores = sorted[0].data().questionScores || {};
        }

        // 삭제된 퀴즈: reviews 컬렉션에서 폴백 로드
        if (!quizDoc.exists()) {
          const reviewFallbackQuery = query(
            collection(db, 'reviews'),
            where('userId', '==', user.uid),
            where('quizId', '==', folderId)
          );
          const reviewFallbackDocs = await getDocs(reviewFallbackQuery);
          if (reviewFallbackDocs.empty) {
            setLibraryQuestions([]);
            setLibraryQuizTitle('삭제된 퀴즈');
            setLibraryLoading(false);
            return;
          }
          // reviews에서 퀴즈 제목 추출
          const firstReview = reviewFallbackDocs.docs[0].data();
          setLibraryQuizTitle(firstReview.quizTitle || '삭제된 퀴즈');
          // reviews를 ReviewItem으로 변환
          const fallbackItems: ReviewItem[] = reviewFallbackDocs.docs.map(d => {
            const data = d.data();
            return {
              id: d.id,
              reviewId: d.id,
              userId: user.uid,
              quizId: folderId,
              quizTitle: data.quizTitle || '삭제된 퀴즈',
              questionId: data.questionId || '',
              question: data.question || '',
              type: data.type || 'multiple',
              options: data.options || [],
              correctAnswer: data.correctAnswer || '',
              userAnswer: data.userAnswer || '',
              explanation: data.explanation || '',
              choiceExplanations: data.choiceExplanations || undefined,
              reviewType: data.reviewType || 'solved',
              isBookmarked: data.isBookmarked || false,
              isCorrect: data.isCorrect,
              reviewCount: data.reviewCount || 0,
              lastReviewedAt: data.lastReviewedAt || null,
              createdAt: data.createdAt,
              image: data.image || undefined,
              imageUrl: data.imageUrl || undefined,
              passage: data.passage || undefined,
              passageType: data.passageType || undefined,
              passageImage: data.passageImage || undefined,
              koreanAbcItems: data.koreanAbcItems || undefined,
              passageMixedExamples: data.passageMixedExamples || undefined,
              commonQuestion: data.commonQuestion || undefined,
              mixedExamples: data.mixedExamples || undefined,
              bogi: data.bogi || undefined,
              subQuestionOptions: data.subQuestionOptions || undefined,
              subQuestionOptionsType: data.subQuestionOptionsType || undefined,
              subQuestionImage: data.subQuestionImage || undefined,
              passagePrompt: data.passagePrompt || undefined,
              bogiQuestionText: data.bogiQuestionText || undefined,
              combinedGroupId: data.combinedGroupId || undefined,
              combinedIndex: data.combinedIndex,
              combinedTotal: data.combinedTotal,
              quizCreatorId: data.quizCreatorId || undefined,
            };
          });
          setLibraryQuestions(sortByQuestionId(fallbackItems));
          setLibraryLoading(false);
          return;
        }

        const quizData = quizDoc.data();
        setLibraryQuizTitle(quizData.title || '퀴즈');

        // reviews 컬렉션에서 choiceExplanations 가져오기 (퀴즈 문서에 없을 수 있음)
        const reviewQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', folderId),
          where('reviewType', '==', 'solved')
        );
        const reviewDocs = await getDocs(reviewQuery);
        const reviewChoiceExplanationsMap: Record<string, string[]> = {};
        reviewDocs.docs.forEach(d => {
          const data = d.data();
          if (data.choiceExplanations && Array.isArray(data.choiceExplanations) && data.choiceExplanations.length > 0) {
            reviewChoiceExplanationsMap[data.questionId] = data.choiceExplanations;
          }
        });
        // questions 배열을 ReviewItem 형식으로 변환
        const questions = quizData.questions || [];

        // questionScores의 userAnswer가 0-indexed인지 1-indexed인지 자동 감지
        // 정답인 문제에서 scoreData.userAnswer == q.answer(0-indexed)이면 0-indexed 데이터
        let scoreAnswerIsZeroIndexed = false;
        if (Object.keys(questionScores).length > 0) {
          for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const qId = q.id || `q${i}`;
            const sd = questionScores[qId];
            if (sd && sd.isCorrect === true && q.type === 'multiple' && q.answer !== undefined) {
              const ua = Number(sd.userAnswer);
              const ca = typeof q.answer === 'number' ? q.answer : Number(q.answer);
              if (!isNaN(ua) && !isNaN(ca)) {
                // userAnswer와 correctAnswer(0-indexed)가 같으면 0-indexed 데이터
                scoreAnswerIsZeroIndexed = (ua === ca);
                break;
              }
            }
          }
        }

        const items: ReviewItem[] = questions.map((q: any, idx: number) => {
          // 정답 변환 (1-indexed 번호 또는 텍스트)
          let correctAnswer = '';
          if (q.type === 'multiple') {
            // 복수정답 지원: answer가 배열인 경우
            if (Array.isArray(q.answer)) {
              correctAnswer = q.answer.map((a: number) => String(a + 1)).join(',');
            } else {
              // 0-indexed를 1-indexed로 변환
              correctAnswer = String((q.answer ?? 0) + 1);
            }
          } else if (q.type === 'ox') {
            correctAnswer = q.answer === 0 ? 'O' : 'X';
          } else {
            correctAnswer = String(q.answer ?? '');
          }

          // 사용자 답변 변환 (0-indexed → 1-indexed)
          // 퀴즈 문서의 userAnswer는 0-indexed (AIQuizContainer가 저장)
          let userAnswer = '';
          if (q.userAnswer !== undefined && q.userAnswer !== null) {
            if (q.type === 'multiple') {
              if (Array.isArray(q.userAnswer)) {
                userAnswer = q.userAnswer.map((a: any) => String(Number(a) + 1)).join(',');
              } else if (typeof q.userAnswer === 'number') {
                userAnswer = String(q.userAnswer + 1);
              } else if (typeof q.userAnswer === 'string' && q.userAnswer !== '' && !isNaN(Number(q.userAnswer))) {
                // 0-indexed 문자열 (예: "2") → 1-indexed (예: "3")
                if (q.userAnswer.includes(',')) {
                  userAnswer = q.userAnswer.split(',').map((a: string) => String(Number(a.trim()) + 1)).join(',');
                } else {
                  userAnswer = String(Number(q.userAnswer) + 1);
                }
              } else {
                userAnswer = String(q.userAnswer);
              }
            } else if (q.type === 'ox') {
              const ua = typeof q.userAnswer === 'number' ? q.userAnswer : Number(q.userAnswer);
              if (ua === 0 || q.userAnswer === 'O') userAnswer = 'O';
              else if (ua === 1 || q.userAnswer === 'X') userAnswer = 'X';
              else userAnswer = String(q.userAnswer);
            } else {
              userAnswer = String(q.userAnswer);
            }
          }

          // quizResults에서 해당 문제 결과 가져오기
          // questionScores 키는 question ID (예: "q1", "q2" 또는 커스텀 ID)
          const questionId = q.id || `q${idx}`;
          const scoreData = questionScores[questionId];

          // scoreData.userAnswer 변환 (0-indexed 데이터면 1-indexed로 변환)
          let finalUserAnswer = userAnswer; // 기본값: 퀴즈 문서에서 변환한 값
          if (scoreData?.userAnswer !== undefined) {
            const rawUA = String(scoreData.userAnswer);
            if (scoreAnswerIsZeroIndexed && q.type === 'multiple') {
              // 0-indexed → 1-indexed 변환
              if (rawUA.includes(',')) {
                finalUserAnswer = rawUA.split(',').map((a: string) => String(Number(a.trim()) + 1)).join(',');
              } else if (rawUA !== '' && !isNaN(Number(rawUA))) {
                finalUserAnswer = String(Number(rawUA) + 1);
              } else {
                finalUserAnswer = rawUA;
              }
            } else {
              finalUserAnswer = rawUA;
            }
          }

          return {
            id: `library-${folderId}-${q.id || `q${idx}`}`,
            userId: user.uid,
            quizId: folderId,
            quizTitle: quizData.title || '퀴즈',
            questionId: q.id || `q${idx}`,
            question: q.text || '',
            type: q.type || 'multiple',
            options: q.choices || [],
            correctAnswer,
            userAnswer: finalUserAnswer,
            explanation: q.explanation || '',
            choiceExplanations: q.choiceExplanations || reviewChoiceExplanationsMap[q.id || `q${idx}`] || undefined,
            reviewType: scoreData?.isCorrect === false ? 'wrong' as const : 'solved' as const,
            isBookmarked: false,
            isCorrect: scoreData?.isCorrect ?? (q.isCorrect !== undefined ? q.isCorrect : undefined),
            reviewCount: 0,
            lastReviewedAt: null,
            createdAt: quizData.createdAt,
            // 이미지
            image: q.image || undefined,
            imageUrl: q.imageUrl || undefined,
            // 제시문
            passage: q.passage || undefined,
            passageType: q.passageType || undefined,
            passageImage: q.passageImage || undefined,
            koreanAbcItems: q.koreanAbcItems || undefined,
            passageMixedExamples: q.passageMixedExamples || undefined,
            commonQuestion: q.commonQuestion || undefined,
            // 보기
            mixedExamples: q.mixedExamples || undefined,
            bogi: q.bogi || undefined,
            subQuestionOptions: q.subQuestionOptions || undefined,
            subQuestionOptionsType: q.subQuestionOptionsType || undefined,
            subQuestionImage: q.subQuestionImage || undefined,
            // 발문
            passagePrompt: q.passagePrompt || undefined,
            bogiQuestionText: q.bogiQuestionText || undefined,
            // 결합형
            combinedGroupId: q.combinedGroupId || undefined,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
            // 기타
            quizCreatorId: quizData.creatorId || undefined,
          };
        });

        setLibraryQuestions(sortByQuestionId(items));
      } catch (err) {
        console.error('서재 퀴즈 로드 오류:', err);
        setLibraryQuestions([]);
        setLibraryQuizTitle('');
      }
      setLibraryLoading(false);
    };

    loadLibraryQuiz();
  }, [user, folderType, folderId]);

  // 찜 퀴즈 폴백 로드 (bookmark 리뷰도 solved 리뷰도 없을 때 퀴즈 문서에서 직접 로드)
  useEffect(() => {
    if (!user || folderType !== 'bookmark') return;
    if (reviewLoading) return; // useReview 로딩 완료 대기

    // bookmark 또는 solved 리뷰가 있으면 폴백 불필요
    const hasBookmarkReviews = groupedBookmarkedItems.some(g => g.quizId === folderId);
    const hasSolvedReviews = groupedSolvedItems.some(g => g.quizId === folderId);
    if (hasBookmarkReviews || hasSolvedReviews) return;

    const loadBookmarkFallback = async () => {
      setBookmarkFallbackLoading(true);
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) {
          setBookmarkFallbackQuestions([]);
          setBookmarkFallbackTitle('');
          setBookmarkFallbackLoading(false);
          return;
        }

        const quizData = quizDoc.data();
        setBookmarkFallbackTitle(quizData.title || '퀴즈');

        const rawQuestions = quizData.questions || [];
        const items: ReviewItem[] = rawQuestions.map((q: any, idx: number) => {
          let correctAnswer = '';
          if (q.type === 'multiple') {
            if (Array.isArray(q.answer)) {
              correctAnswer = q.answer.map((a: number) => String(a + 1)).join(',');
            } else {
              correctAnswer = String((q.answer ?? 0) + 1);
            }
          } else if (q.type === 'ox') {
            correctAnswer = q.answer === 0 ? 'O' : 'X';
          } else {
            correctAnswer = String(q.answer ?? '');
          }

          const questionId = q.id || `q${idx}`;
          return {
            id: `fallback-${folderId}-${questionId}`,
            userId: user.uid,
            quizId: folderId,
            quizTitle: quizData.title || '퀴즈',
            questionId,
            question: q.question || q.text || '',
            type: q.type === 'short' ? 'short_answer' : (q.type || 'multiple'),
            options: q.choices || q.options || [],
            correctAnswer,
            userAnswer: '',
            explanation: q.explanation || '',
            reviewType: 'bookmark' as const,
            isBookmarked: true,
            isCorrect: undefined,
            reviewCount: 0,
            lastReviewedAt: null,
            createdAt: quizData.createdAt || Timestamp.now(),
            // 결합형 문제 필드
            combinedGroupId: q.combinedGroupId,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
            passage: q.passage,
            passageType: q.passageType,
            passageImage: q.passageImage,
            koreanAbcItems: q.koreanAbcItems,
            passageMixedExamples: q.passageMixedExamples,
            commonQuestion: q.commonQuestion,
            image: q.image || q.imageUrl,
            mixedExamples: q.mixedExamples,
            subQuestionOptions: q.subQuestionOptions,
            subQuestionOptionsType: q.subQuestionOptionsType,
            subQuestionImage: q.subQuestionImage,
            choiceExplanations: q.choiceExplanations,
            passagePrompt: q.passagePrompt,
            bogiQuestionText: q.bogiQuestionText,
            bogi: q.bogi,
          } as ReviewItem;
        });

        setBookmarkFallbackQuestions(sortByQuestionId(items));
      } catch (err) {
        console.error('찜 퀴즈 폴백 로드 실패:', err);
        setBookmarkFallbackQuestions([]);
        setBookmarkFallbackTitle('');
      }
      setBookmarkFallbackLoading(false);
    };

    loadBookmarkFallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, folderType, folderId, reviewLoading, groupedBookmarkedItems, groupedSolvedItems]);

  // 최종 데이터
  const baseFolderTitle = folderData?.title || '';
  // 챕터 필터가 있으면 제목에 챕터 정보 추가
  const chapterName = chapterFilter && userCourse?.id
    ? getChapterById(userCourse.id, chapterFilter)?.name
    : null;
  const folderTitle = chapterName ? `${baseFolderTitle} (${chapterName})` : baseFolderTitle;
  const questions = folderType === 'library'
    ? libraryQuestions
    : folderType === 'custom'
      ? customQuestions
      : (folderData?.items || []);

  // 퀴즈별 creatorId 로드 (자기 문제 피드백 방지용)
  useEffect(() => {
    if (questions.length === 0) return;

    const loadQuizCreators = async () => {
      // 고유한 quizId 목록
      const quizIds = [...new Set(questions.map(q => q.quizId))];
      const newCreatorMap = new Map<string, string>();
      const newAiMap = new Map<string, boolean>();

      for (const quizId of quizIds) {
        // 이미 로드된 것은 스킵
        if (quizCreatorsMap.has(quizId)) {
          newCreatorMap.set(quizId, quizCreatorsMap.get(quizId)!);
          newAiMap.set(quizId, quizAiMap.get(quizId) || false);
          continue;
        }

        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (quizDoc.exists()) {
            const data = quizDoc.data();
            if (data?.creatorId) {
              newCreatorMap.set(quizId, data.creatorId);
            }
            newAiMap.set(quizId, data?.isAiGenerated || data?.type === 'ai-generated' || false);
          }
        } catch (err) {
          console.error(`퀴즈 ${quizId} creatorId 로드 실패:`, err);
        }
      }

      if (newCreatorMap.size > 0) {
        setQuizCreatorsMap(prev => {
          const merged = new Map(prev);
          newCreatorMap.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
      if (newAiMap.size > 0) {
        setQuizAiMap(prev => {
          const merged = new Map(prev);
          newAiMap.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
    };

    loadQuizCreators();
  }, [questions]);

  // 문제별 수정 여부 체크 (문제 아코디언 뱃지 표시용)
  useEffect(() => {
    if (questions.length === 0) return;
    // bookmark 타입은 문제지 단위만 표시하므로 문제별 뱃지 불필요
    if (folderType === 'bookmark') return;

    const checkQuestionUpdates = async () => {
      const newUpdatedIds = new Set<string>();
      // 고유 quizId별로 그룹화
      const quizIdToItems = new Map<string, ReviewItem[]>();
      for (const q of questions) {
        const list = quizIdToItems.get(q.quizId) || [];
        list.push(q);
        quizIdToItems.set(q.quizId, list);
      }

      for (const [quizId, items] of quizIdToItems) {
        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (!quizDoc.exists()) continue;

          const quizData = quizDoc.data();
          const quizQuestions = quizData?.questions || [];

          // quizQuestions를 questionId로 매핑
          const questionMap = new Map<string, any>();
          quizQuestions.forEach((q: any, idx: number) => {
            const qId = q.id || `q${idx}`;
            questionMap.set(qId, q);
          });

          for (const item of items) {
            const savedTime = item.quizUpdatedAt?.toMillis?.() || 0;
            if (!savedTime) continue;

            const quizQuestion = questionMap.get(item.questionId);
            if (!quizQuestion?.questionUpdatedAt) continue;

            const questionTime = quizQuestion.questionUpdatedAt.toMillis
              ? quizQuestion.questionUpdatedAt.toMillis()
              : 0;

            if (questionTime > savedTime) {
              newUpdatedIds.add(item.questionId);
            }
          }
        } catch (err) {
          console.error(`퀴즈 ${quizId} 문제 수정 여부 확인 실패:`, err);
        }
      }

      setUpdatedQuestionIds(newUpdatedIds);
    };

    checkQuestionUpdates();
  }, [questions, folderType]);

  // solved/bookmark/library 타입일 때 퀴즈 점수 가져오기
  useEffect(() => {
    if (!user || (folderType !== 'solved' && folderType !== 'bookmark' && folderType !== 'library')) {
      setQuizScores(null);
      return;
    }

    const loadQuizScores = async () => {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (quizDoc.exists()) {
          const data = quizDoc.data();
          setQuizScores({
            myScore: data.userScores?.[user.uid] ?? data.score,
            myFirstReviewScore: data.userFirstReviewScores?.[user.uid],
            averageScore: data.averageScore,
            isPublic: data.isPublic ?? false,
          });
        }
      } catch (err) {
        console.error('퀴즈 점수 로드 실패:', err);
      }
    };

    loadQuizScores();
  }, [user, folderType, folderId]);

  const loading = folderType === 'library'
    ? libraryLoading
    : folderType === 'custom'
      ? customLoading
      : folderType === 'bookmark'
        ? (!folderData && (reviewLoading || bookmarkFallbackLoading))
        : !folderData;

  // displayItems 계산 (결합형 문제 그룹핑)
  const displayItems = useMemo(() => {
    return createDisplayItems(questions);
  }, [questions]);

  // 결합형 그룹 펼침/접힘 토글
  const toggleGroupExpand = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  }, []);

  // 문제 선택/해제
  const handleSelectQuestion = (questionId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(questionId)) {
      newSelected.delete(questionId);
    } else {
      newSelected.add(questionId);
    }
    setSelectedIds(newSelected);
  };

  // 선택된 문제로 연습 시작 (전체 복습)
  const handleStartPractice = () => {
    const targetItems = selectedIds.size === 0
      ? questions
      : questions.filter(q => selectedIds.has(q.id));

    if (targetItems.length === 0) {
      // 복습할 문제가 없으면 임시 메시지 표시
      setShowEmptyMessage(true);
      setTimeout(() => setShowEmptyMessage(false), 500);
      return;
    }

    setPracticeMode('all'); // 전체 복습 모드
    setPracticeItems(targetItems);
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  // 오답만 복습하기
  const handleStartWrongOnlyPractice = () => {
    // 현재 questions 중에서 wrongItems에도 있는 것만 필터링
    const wrongQuestionKeys = new Set(
      wrongItems
        .filter(w => w.quizId === folderId)
        .map(w => `${w.quizId}:${w.questionId}`)
    );

    const wrongOnlyItems = questions.filter(q =>
      wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`)
    );

    if (wrongOnlyItems.length === 0) {
      showToast('이 문제지에 오답이 없습니다');
      return;
    }

    setPracticeMode('wrongOnly'); // 오답만 복습 모드 (첫복습점수 저장 안함)
    setPracticeItems(wrongOnlyItems);
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  // 수정 모드 진입 핸들러
  const handleEnterEditMode = () => {
    setEditedTitle(libraryQuizTitle);
    setEditedQuestions({});
    setIsEditMode(true);
  };

  // 수정 모드 저장 핸들러 (제목 + 문제 일괄 저장)
  const handleSaveEdits = async () => {
    const editedKeys = Object.keys(editedQuestions);
    const titleChanged = editedTitle.trim() && editedTitle.trim() !== libraryQuizTitle;

    if (editedKeys.length === 0 && !titleChanged) {
      setIsEditMode(false);
      return;
    }

    setIsSavingEdit(true);
    try {
      const updateData: Record<string, any> = {};

      // 제목 변경
      if (titleChanged) {
        updateData.title = editedTitle.trim();
      }

      // 문제 변경
      if (editedKeys.length > 0) {
        const quizDoc = await getDoc(doc(db, 'quizzes', folderId));
        if (!quizDoc.exists()) {
          showToast('퀴즈를 찾을 수 없습니다');
          setIsSavingEdit(false);
          return;
        }

        const quizData = quizDoc.data();
        const updatedQs = [...(quizData.questions || [])];

        // 로컬 libraryQuestions의 choiceExplanations를 questionId로 매핑
        // (reviews 폴백으로 로드된 데이터가 퀴즈 문서에 없을 수 있음)
        const localChoiceExpsMap = new Map<string, string[]>();
        libraryQuestions.forEach(item => {
          if (item.choiceExplanations && item.choiceExplanations.length > 0) {
            localChoiceExpsMap.set(item.questionId, item.choiceExplanations);
          }
        });

        // 모든 문제의 choiceExplanations를 퀴즈 문서에 동기화
        updatedQs.forEach((q: any, idx: number) => {
          const qId = q.id || `q${idx}`;
          if (!q.choiceExplanations) {
            const localExps = localChoiceExpsMap.get(qId);
            if (localExps) {
              q.choiceExplanations = localExps;
            }
          }
        });

        for (const questionId of editedKeys) {
          const edits = editedQuestions[questionId];
          const qIdx = updatedQs.findIndex((q: any, idx: number) => (q.id || `q${idx}`) === questionId);
          if (qIdx === -1) continue;

          if (edits.question !== undefined) updatedQs[qIdx].text = edits.question;
          if (edits.options !== undefined) updatedQs[qIdx].choices = edits.options;
          if (edits.explanation !== undefined) updatedQs[qIdx].explanation = edits.explanation;
          if (edits.choiceExplanations !== undefined) updatedQs[qIdx].choiceExplanations = edits.choiceExplanations;
        }

        updateData.questions = updatedQs;
      }

      await updateDoc(doc(db, 'quizzes', folderId), updateData);

      // 로컬 state 갱신
      if (titleChanged) {
        setLibraryQuizTitle(editedTitle.trim());
      }
      if (editedKeys.length > 0) {
        setLibraryQuestions(prev =>
          prev.map(item => {
            const edits = editedQuestions[item.questionId];
            if (!edits) return item;
            return {
              ...item,
              question: edits.question ?? item.question,
              options: edits.options ?? item.options,
              explanation: edits.explanation ?? item.explanation,
              choiceExplanations: edits.choiceExplanations ?? item.choiceExplanations,
            };
          })
        );
      }

      setIsEditMode(false);
      setEditedQuestions({});
      showToast('수정 완료');
    } catch (err) {
      console.error('수정 실패:', err);
      showToast('수정에 실패했습니다');
    }
    setIsSavingEdit(false);
  };

  // 수정 모드 취소 핸들러
  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditedQuestions({});
    setEditedTitle('');
  };

  // 현재 문제지의 오답 개수 계산
  const wrongCount = useMemo(() => {
    if (folderType === 'wrong') return questions.length; // 이미 오답만 보여주는 경우
    const wrongQuestionKeys = new Set(
      wrongItems
        .filter(w => w.quizId === folderId)
        .map(w => `${w.quizId}:${w.questionId}`)
    );
    return questions.filter(q => wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`)).length;
  }, [folderType, folderId, questions, wrongItems]);

  // 퀴즈 페이지에서 autoStart 파라미터로 바로 복습 시작
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || loading || questions.length === 0) return;
    autoStartedRef.current = true;

    if (autoStart === 'wrongOnly') {
      // wrong 타입: 이미 오답만 로드됨 → 전체 복습
      if (folderType === 'wrong') {
        setPracticeMode('wrongOnly');
        setPracticeItems(questions);
      } else {
        // library 타입에서 오답만 필터링
        const wrongQuestionKeys = new Set(
          wrongItems
            .filter(w => w.quizId === folderId)
            .map(w => `${w.quizId}:${w.questionId}`)
        );
        const wrongOnlyItems = questions.filter(q =>
          wrongQuestionKeys.has(`${q.quizId}:${q.questionId}`)
        );
        if (wrongOnlyItems.length > 0) {
          setPracticeMode('wrongOnly');
          setPracticeItems(wrongOnlyItems);
        }
      }
    } else {
      // autoStart === 'all'
      setPracticeMode('all');
      setPracticeItems(questions);
    }
  }, [autoStart, loading, questions, wrongItems, folderType, folderId]);

  // 선택된 문제들 삭제
  const handleDeleteSelectedQuestions = async () => {
    if (selectedIds.size === 0) return;

    const confirmed = window.confirm(`선택한 ${selectedIds.size}개의 문제를 삭제하시겠습니까?`);
    if (!confirmed) return;

    const deletedCount = selectedIds.size;

    try {
      if (folderType === 'custom') {
        // 커스텀 폴더에서 문제 제거
        for (const itemId of selectedIds) {
          const item = questions.find(q => q.id === itemId);
          if (item) {
            await removeFromCustomFolder(folderId, item.questionId);
          }
        }
        setCustomQuestions(prev => prev.filter(q => !selectedIds.has(q.id)));
      } else {
        // reviews에서 직접 삭제
        for (const itemId of selectedIds) {
          await deleteReviewItem(itemId);
        }
      }
      // 삭제된 항목만 선택에서 제거 (선택 모드 유지)
      setSelectedIds(new Set());
      showToast(`${deletedCount}개 문제 삭제 완료`);
    } catch (err) {
      console.error('문제 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // 문제 추가 확정
  const handleAddQuestions = async (selectedKeys: string[]) => {
    if (selectedKeys.length === 0) return;

    try {
      const uniqueItems: ReviewItem[] = [];
      const seenKeys = new Set<string>();

      for (const key of selectedKeys) {
        if (seenKeys.has(key)) continue;
        const colonIndex = key.indexOf(':');
        if (colonIndex === -1) continue;
        const quizId = key.substring(0, colonIndex);
        const questionId = key.substring(colonIndex + 1);
        const item = solvedItems.find(i =>
          i.questionId === questionId && i.quizId === quizId
        );
        if (item) {
          uniqueItems.push(item);
          seenKeys.add(key);
        }
      }

      const questionsToAdd = uniqueItems.map(item => ({
        questionId: item.questionId,
        quizId: item.quizId,
        quizTitle: item.quizTitle || '',
        combinedGroupId: item.combinedGroupId || null, // 결합형 그룹 ID 포함
      }));

      await addToCustomFolder(folderId, questionsToAdd);

      // 추가된 문제 UI 업데이트
      setCustomQuestions(prev => [...prev, ...uniqueItems]);

      // 실제 문제 수 계산 (결합형은 1문제로 계산)
      const combinedGroups = new Set<string>();
      let actualQuestionCount = 0;
      for (const item of uniqueItems) {
        if (item.combinedGroupId) {
          if (!combinedGroups.has(item.combinedGroupId)) {
            combinedGroups.add(item.combinedGroupId);
            actualQuestionCount++;
          }
        } else {
          actualQuestionCount++;
        }
      }
      showToast(`${actualQuestionCount}개 문제 추가 완료`);
    } catch (err) {
      console.error('문제 추가 실패:', err);
      alert('추가에 실패했습니다.');
    }
  };

  // 카테고리 추가 핸들러
  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || folderType !== 'custom') return;

    try {
      await addCategoryToFolder(folderId, newCategoryName.trim());
      setNewCategoryName('');
    } catch (err) {
      console.error('카테고리 추가 실패:', err);
      alert('카테고리 추가에 실패했습니다.');
    }
  };

  // 카테고리 삭제 핸들러
  const handleRemoveCategory = async (categoryId: string) => {
    if (folderType !== 'custom') return;

    const confirmed = window.confirm('이 카테고리를 삭제하시겠습니까? 해당 문제들은 미분류로 변경됩니다.');
    if (!confirmed) return;

    try {
      await removeCategoryFromFolder(folderId, categoryId);
    } catch (err) {
      console.error('카테고리 삭제 실패:', err);
      alert('카테고리 삭제에 실패했습니다.');
    }
  };

  // 문제 카테고리 배정 핸들러
  const handleAssignToCategory = async (questionId: string, categoryId: string | null) => {
    if (folderType !== 'custom') return;

    try {
      await assignQuestionToCategory(folderId, questionId, categoryId);
      // 로컬 상태 업데이트
      setCustomQuestions(prev => prev.map(q => {
        if (q.questionId === questionId) {
          return { ...q, categoryId: categoryId || undefined } as ReviewItem & { categoryId?: string };
        }
        return q;
      }));
    } catch (err) {
      console.error('카테고리 배정 실패:', err);
    }
  };

  // 선택된 문제들을 카테고리에 일괄 배정
  const handleBulkAssign = async () => {
    if (selectedIds.size === 0 || !selectedCategoryForAssign) return;

    try {
      for (const itemId of selectedIds) {
        const item = questions.find(q => q.id === itemId);
        if (item) {
          await assignQuestionToCategory(folderId, item.questionId, selectedCategoryForAssign);
        }
      }
      // 로컬 상태 업데이트
      setCustomQuestions(prev => prev.map(q => {
        if (selectedIds.has(q.id)) {
          return { ...q, categoryId: selectedCategoryForAssign || undefined } as ReviewItem & { categoryId?: string };
        }
        return q;
      }));
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setIsAssignMode(false);
      setSelectedCategoryForAssign(null);
    } catch (err) {
      console.error('일괄 배정 실패:', err);
      alert('배정에 실패했습니다.');
    }
  };

  // 카테고리별로 문제 그룹핑
  const groupedByCategory = useMemo(() => {
    if (folderType !== 'custom' || !customFolder?.categories?.length) {
      return null;
    }

    const categories = customFolder.categories;
    const folderQuestions = customFolder.questions || [];

    // 각 카테고리별 문제 그룹
    const groups: { category: FolderCategory | null; items: ReviewItem[] }[] = [];

    // 미분류 그룹
    const uncategorized: ReviewItem[] = [];

    // 카테고리별로 문제 분류
    for (const category of categories) {
      const categoryQuestionIds = folderQuestions
        .filter((q: CustomFolderQuestion) => q.categoryId === category.id)
        .map((q: CustomFolderQuestion) => q.questionId);

      const categoryItems = customQuestions.filter(q =>
        categoryQuestionIds.includes(q.questionId)
      );

      groups.push({ category, items: categoryItems });
    }

    // 미분류 문제
    const categorizedQuestionIds = folderQuestions
      .filter((q: CustomFolderQuestion) => q.categoryId)
      .map((q: CustomFolderQuestion) => q.questionId);

    const uncategorizedItems = customQuestions.filter(q =>
      !categorizedQuestionIds.includes(q.questionId)
    );

    if (uncategorizedItems.length > 0) {
      groups.push({ category: null, items: uncategorizedItems });
    }

    return groups;
  }, [folderType, customFolder, customQuestions]);

  // 피드백 제출 핸들러
  const handleFeedbackSubmit = async (questionId: string, type: FeedbackType, content: string) => {
    if (!user) return;

    // 문제 정보 찾기
    const item = questions.find(q => q.questionId === questionId);
    const quizId = item?.quizId || folderId;

    // quizCreatorId 결정: 1) 리뷰 아이템에서, 2) quizCreatorsMap에서
    const creatorId = item?.quizCreatorId || quizCreatorsMap.get(quizId) || null;

    // questionId에서 문제 번호 추출 (예: "q0" → 1, "q2-1" → 3)
    const [mainIdx] = parseQuestionId(questionId);
    const questionNumber = mainIdx + 1;

    const feedbackRef = collection(db, 'questionFeedbacks');
    await addDoc(feedbackRef, {
      questionId,
      quizId,
      quizCreatorId: creatorId, // 퀴즈 생성자 ID (조회 최적화용)
      userId: user.uid,
      questionNumber, // 문제 번호 (표시용)
      type,
      content,
      createdAt: serverTimestamp(),
    });
  };

  // 복습 완료 핸들러
  const handlePracticeComplete = useCallback(async (results: PracticeResult[]) => {
    // 복습 완료된 문제 reviewCount 증가 (복습력 측정용)
    // 합성 ID(library-, fallback-)는 Firestore에 실제 문서가 없으므로 스킵
    for (const r of results) {
      if (r.reviewId.startsWith('library-') || r.reviewId.startsWith('fallback-')) continue;
      try { await markAsReviewed(r.reviewId); } catch { /* 개별 실패 무시 */ }
    }

    if (folderId && user && folderType !== 'custom' && results.length > 0) {
      const quizDocSnap = await getDoc(doc(db, 'quizzes', folderId)).catch(() => null);
      const quizData = quizDocSnap?.data();
      const correctCount = results.filter(r => r.isCorrect).length;
      const totalCount = quizData?.questions?.length || results.length;
      const reviewScore = Math.round((correctCount / totalCount) * 100);

      // 1. 복습 연습 EXP 지급 — CF가 quizResults 생성 + EXP 처리
      try {
        const recordReviewPracticeFn = httpsCallable(functions, 'recordReviewPractice');
        await recordReviewPracticeFn({
          quizId: folderId,
          correctCount,
          totalCount,
          score: reviewScore,
        });
      } catch (err) {
        console.error('복습 EXP 지급 실패:', err);
      }

      // 2. 첫 복습 점수 저장 (전체 복습 모드에서만, 최초 1회)
      if (practiceModeRef.current === 'all' && quizData) {
        try {
          const existingReviewScore = quizData.userFirstReviewScores?.[user.uid];
          if (existingReviewScore === undefined) {
            await updateDoc(doc(db, 'quizzes', folderId), {
              [`userFirstReviewScores.${user.uid}`]: reviewScore,
            });
            // 로컬 상태 즉시 갱신
            setQuizScores(prev => prev ? { ...prev, myFirstReviewScore: reviewScore } : prev);
          }
        } catch (err) {
          console.error('첫 복습 점수 저장 실패:', err);
        }
      }

      // 3. 해당 퀴즈의 모든 reviews 문서 업데이트 (뱃지 제거)
      if (quizData) {
        try {
          const currentQuizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;
          const reviewsQuery = query(
            collection(db, 'reviews'),
            where('userId', '==', user.uid),
            where('quizId', '==', folderId)
          );
          const reviewsSnapshot = await getDocs(reviewsQuery);
          for (const reviewDoc of reviewsSnapshot.docs) {
            await updateDoc(reviewDoc.ref, { quizUpdatedAt: currentQuizUpdatedAt });
          }
        } catch (err) {
          console.error('리뷰 뱃지 업데이트 실패:', err);
        }
      }
    }

    if (autoStart) {
      router.back();
    } else {
      setPracticeItems(null);
      setPracticeMode(null);
    }
  }, [folderId, user, folderType, autoStart, markAsReviewed, router]);

  // autoStart 모드: 데이터 로딩 중이면 로딩 스피너만 표시 (폴더 상세 안 보여줌)
  if (autoStart && !practiceItems && (loading || questions.length === 0)) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
          <p className="text-[#3A3A3A] text-sm">복습 준비 중...</p>
        </div>
      </div>
    );
  }

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        quizTitle={folderTitle}
        onComplete={handlePracticeComplete}
        onClose={() => {
          if (autoStart) {
            router.back();
          } else {
            setPracticeItems(null);
            setPracticeMode(null);
          }
        }}
        currentUserId={user?.uid}
      />
    );
  }

  // 문제 추가 모드 - AddQuestionsView 컴포넌트로 분리
  if (isAddMode && folderType === 'custom' && customFolder) {
    return (
      <AddQuestionsView
        groupedSolvedItems={groupedSolvedItems}
        solvedItems={solvedItems}
        customFolderQuestions={customFolder.questions}
        onClose={() => setIsAddMode(false)}
        onAddQuestions={handleAddQuestions}
      />
    );
  }

  // 필터 변경 핸들러 (리뷰 페이지로 이동)
  const handleFilterChange = (filter: ReviewFilter) => {
    // 현재 폴더 타입과 다른 필터를 선택하면 리뷰 페이지로 이동
    if (filter !== folderType) {
      router.push(`/review?filter=${filter}`);
    }
  };

  return (
    <motion.div
      className="min-h-screen pb-24" style={{ backgroundColor: '#F5F0E8' }}
      initial={slideIn ? { opacity: 0, x: 60 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
    >
      {/* 헤더 - 배너 이미지 */}
      <header className="pt-2 pb-1 flex flex-col items-center">
        {/* 리본 이미지 — 퀴즈 페이지와 동일 크기 */}
        <div className="relative w-full h-[160px] mt-2">
          <Image
            src={ribbonImage}
            alt="Review"
            fill
            className="object-contain"
            style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
            unoptimized
          />
        </div>

        {/* 필터 + 이전 버튼 영역 */}
        <div className="w-full px-4 py-1">
          {folderType === 'solved' ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => router.back()}
                  className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-2xl font-black text-[#1A1A1A] truncate flex-1">
                  {folderTitle}
                </h2>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-serif font-bold text-[#1A1A1A]" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      {quizScores?.myScore !== undefined ? quizScores.myScore : '-'}
                    </span>
                    <span className="text-sm text-[#5C5C5C] mt-2">퀴즈</span>
                  </div>
                  <span className="text-2xl text-[#5C5C5C] font-serif" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>/</span>
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-serif font-bold text-[#1A1A1A]" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      {quizScores?.myFirstReviewScore !== undefined ? quizScores.myFirstReviewScore : '-'}
                    </span>
                    <span className="text-sm text-[#5C5C5C] mt-2">복습</span>
                  </div>
                </div>
                {quizScores?.isPublic && (
                  <div className="flex flex-col items-center">
                    <span className="text-4xl font-serif font-bold text-[#1A1A1A]" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      {quizScores?.averageScore !== undefined ? Math.round(quizScores.averageScore) : '-'}
                    </span>
                    <span className="text-sm text-[#5C5C5C] mt-2">평균</span>
                  </div>
                )}
              </div>
            </>
          ) : fromQuizPage ? (
            /* 퀴즈 페이지 복습탭에서 온 경우: 빈 — 제목은 아래 섹션에서 표시 */
            <div />
          ) : (
            /* 서재/오답/찜/커스텀: 필터 숨김 (상세 페이지에서는 불필요) */
            <div />
          )}
        </div>
      </header>

      {/* 폴더 제목 + 점수 (solved 타입 제외) */}
      {folderType !== 'solved' && (
        <div className="px-4 py-3">
          {/* bookmark/library 타입일 때 제목 + 점수 표시 */}
          {(folderType === 'bookmark' || folderType === 'library') ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                {/* 뒤로가기 < 화살표 */}
                {!isEditMode && (
                  <button
                    onClick={() => router.back()}
                    className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {folderType === 'library' && isEditMode ? (
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    className="flex-1 min-w-0 max-w-[160px] text-2xl font-black text-[#1A1A1A] bg-[#EDEAE4] border-2 border-[#1A1A1A] px-2 py-1 focus:outline-none"
                    autoFocus
                  />
                ) : (
                  <>
                    <h2 className="text-2xl font-black text-[#1A1A1A] flex-1">
                      {folderTitle}
                    </h2>
                    {folderType === 'library' && !isSelectMode && !fromQuizPage && quizCreatorsMap.get(folderId) === user?.uid && (
                      <>
                        <button
                          onClick={handleEnterEditMode}
                          className="p-1.5 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                          title="수정 모드"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setShowDeleteModal(true)}
                          className="p-1.5 text-[#5C5C5C] hover:text-[#C44] transition-colors flex-shrink-0"
                          title="퀴즈 삭제"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-black text-[#1A1A1A]">
                      {quizScores?.myScore !== undefined ? quizScores.myScore : '-'}
                    </span>
                    <span className="text-base text-[#5C5C5C]">/</span>
                    <span className="text-2xl font-black text-[#1A1A1A]">
                      {quizScores?.myFirstReviewScore !== undefined ? quizScores.myFirstReviewScore : '-'}
                    </span>
                  </div>
                  <div className="flex items-center gap-5 mt-1">
                    <span className="text-xs text-[#5C5C5C]">퀴즈</span>
                    <span className="text-xs text-[#5C5C5C]">복습</span>
                  </div>
                </div>
                {/* 평균 점수 (공개 퀴즈만) */}
                {quizScores?.isPublic && (
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-black text-[#1A1A1A]">
                      {quizScores?.averageScore !== undefined ? Math.round(quizScores.averageScore) : '-'}
                    </span>
                    <span className="text-xs text-[#5C5C5C] mt-1">평균</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.back()}
                className="p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-2xl font-black text-[#1A1A1A] truncate flex-1">
                {folderTitle}
              </h2>
              {folderType === 'custom' && !isSelectMode && (
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="p-1.5 text-[#5C5C5C] hover:text-[#C44] transition-colors flex-shrink-0"
                  title="폴더 삭제"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 커스텀 폴더일 때 문제 추가 버튼 */}
      {folderType === 'custom' && !isSelectMode && (
        <div className="px-4 pt-2">
          <button
            onClick={() => setIsAddMode(true)}
            className="w-full py-1.5 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            + 문제 추가하기
          </button>
        </div>
      )}

      {/* 상단 정보 */}
      <div className="px-4 py-3 flex items-center justify-between">
        <p className="text-lg font-bold text-[#5C5C5C]">
          {loading ? '불러오는 중...' : `총 ${questions.length}문제`}
          {isSelectMode && selectedIds.size > 0 && (
            <span className="ml-2 text-[#1A1A1A] font-bold">
              ({selectedIds.size}개 선택)
            </span>
          )}
        </p>
        {/* 수정 모드일 때 선택 버튼 숨김 */}
        {!isEditMode && (
          <div className="flex gap-2">
            {/* 선택 모드일 때 전체 선택 버튼 */}
            {isSelectMode && (
              <button
                onClick={() => {
                  if (selectedIds.size === questions.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(questions.map(q => q.id)));
                  }
                }}
                className="px-2.5 py-1 text-xs font-bold border transition-colors bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4] rounded-md"
              >
                {selectedIds.size === questions.length ? '전체 해제' : '전체'}
              </button>
            )}
            <button
              onClick={() => {
                if (isSelectMode) {
                  setIsSelectMode(false);
                  setIsDeleteMode(false);
                  setIsAssignMode(false);
                  setSelectedIds(new Set());
                } else {
                  setIsSelectMode(true);
                  // 선택 모드에서는 삭제 모드 비활성화 (복습용으로만 사용)
                  setIsDeleteMode(false);
                }
              }}
              className={`px-2.5 py-1 text-xs font-bold border-2 transition-colors rounded-md ${
                isSelectMode
                  ? 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              {isSelectMode ? '취소' : '선택'}
            </button>
          </div>
        )}
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="px-4 space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 rounded-none" />
          ))}
        </div>
      )}

      {/* 문제 목록 */}
      {!loading && (
        <main className="px-4 space-y-2">
          {questions.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[#5C5C5C]">문제가 없습니다.</p>
            </div>
          ) : groupedByCategory ? (
            // 카테고리별로 그룹화된 표시
            <div className="space-y-4">
              {groupedByCategory.map((group, groupIndex) => (
                <div key={group.category?.id || 'uncategorized'}>
                  {/* 카테고리 헤더 */}
                  <div className="flex items-center gap-2 mb-2 mt-4">
                    <span className="font-bold text-[#1A1A1A] text-sm">
                      {group.category?.name || '미분류'}
                    </span>
                    <div className="flex-1 border-t border-dashed border-[#5C5C5C]" />
                    <span className="text-xs text-[#5C5C5C]">
                      {group.items.length}문제
                    </span>
                  </div>
                  {/* 해당 카테고리의 문제들 */}
                  <div className="space-y-2">
                    {group.items.length === 0 ? (
                      <p className="text-xs text-[#5C5C5C] py-2 text-center">문제가 없습니다</p>
                    ) : (
                      group.items.map((item, index) => {
                        // 전체 문제 목록에서의 인덱스 계산
                        let globalIndex = 0;
                        for (let i = 0; i < groupIndex; i++) {
                          globalIndex += groupedByCategory[i].items.length;
                        }
                        globalIndex += index;

                        return (
                          <QuestionCard
                            key={item.id}
                            item={item}
                            questionNumber={globalIndex + 1}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(item.id)}
                            onSelect={() => handleSelectQuestion(item.id)}
                            onFeedbackSubmit={handleFeedbackSubmit}
                            currentUserId={user?.uid}
                            quizCreatorId={quizCreatorsMap.get(item.quizId)}
                            isAiGenerated={quizAiMap.get(item.quizId)}
                            folderType={folderType}
                            courseId={userCourse?.id}
                            hasUpdate={updatedQuestionIds.has(item.questionId)}
                            isEditMode={isEditMode}
                            editData={editedQuestions[item.questionId]}
                            onEditChange={isEditMode ? (field, value) => {
                              setEditedQuestions(prev => ({
                                ...prev,
                                [item.questionId]: { ...prev[item.questionId], [field]: value }
                              }));
                            } : undefined}
                          />
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // 일반 목록 표시 (결합형 그룹 포함)
            displayItems.map((displayItem) => {
              // 단일 문제
              if (displayItem.type === 'single' && displayItem.item) {
                const item = displayItem.item;
                return (
                  <QuestionCard
                    key={item.id}
                    item={item}
                    questionNumber={displayItem.displayNumber}
                    isSelectMode={isSelectMode}
                    isSelected={selectedIds.has(item.id)}
                    onSelect={() => handleSelectQuestion(item.id)}
                    onFeedbackSubmit={handleFeedbackSubmit}
                    currentUserId={user?.uid}
                    quizCreatorId={quizCreatorsMap.get(item.quizId)}
                    isAiGenerated={quizAiMap.get(item.quizId)}
                    courseId={userCourse?.id}
                    folderType={folderType}
                    hasUpdate={updatedQuestionIds.has(item.questionId)}
                    isEditMode={isEditMode}
                    editData={editedQuestions[item.questionId]}
                    onEditChange={isEditMode ? (field, value) => {
                      setEditedQuestions(prev => ({
                        ...prev,
                        [item.questionId]: { ...prev[item.questionId], [field]: value }
                      }));
                    } : undefined}
                  />
                );
              }

              // 결합형 그룹
              if (displayItem.type === 'combined_group' && displayItem.items && displayItem.combinedGroupId) {
                const groupId = displayItem.combinedGroupId;
                const groupItems = displayItem.items;
                const correctInGroup = groupItems.filter(r => r.isCorrect).length;
                const totalInGroup = groupItems.length;
                const firstItem = groupItems[0];
                const isGroupExpanded = expandedGroupIds.has(groupId);

                // 그룹 내 선택된 문제 수
                const selectedInGroup = groupItems.filter(r => selectedIds.has(r.id)).length;
                const isGroupSelected = selectedInGroup > 0;

                return (
                  <div key={groupId}>
                    {/* 그룹 헤더 */}
                    <div
                      onClick={() => {
                        if (isSelectMode) {
                          // 선택 모드: 그룹 전체 선택/해제
                          const newSelected = new Set(selectedIds);
                          if (selectedInGroup === totalInGroup) {
                            groupItems.forEach(r => newSelected.delete(r.id));
                          } else {
                            groupItems.forEach(r => newSelected.add(r.id));
                          }
                          setSelectedIds(newSelected);
                        } else {
                          toggleGroupExpand(groupId);
                        }
                      }}
                      className={`border p-3 cursor-pointer transition-all ${
                        isSelectMode
                          ? isGroupSelected
                            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
                            : 'border border-dashed border-[#5C5C5C] bg-[#F5F0E8]'
                          : 'border-[#1A1A1A] bg-[#F5F0E8]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* 문항 번호 + 결합형 표시 + 정답 수 */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="inline-block px-2 py-0.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                              Q{displayItem.displayNumber}
                            </span>
                            <span className="inline-block px-2 py-0.5 text-xs font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                              결합형 문제
                            </span>
                            <span className={`inline-block px-2 py-0.5 text-xs font-bold ${
                              correctInGroup === totalInGroup
                                ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                                : correctInGroup > 0
                                ? 'bg-[#FFF8E1] text-[#8B6914] border border-[#8B6914]'
                                : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
                            }`}>
                              {correctInGroup}/{totalInGroup} 정답
                            </span>
                          </div>
                          {/* 공통 지문/문제 미리보기 */}
                          <p className="text-sm text-[#1A1A1A]">
                            {firstItem.commonQuestion || firstItem.passage || '결합형 문제'}
                            {/* 제시문 발문 표시 */}
                            {firstItem.passagePrompt && (
                              <span className="ml-1 text-[#5C5C5C]">
                                {firstItem.passagePrompt}
                              </span>
                            )}
                          </p>
                        </div>

                        {/* 오른쪽 영역: 체크박스/화살표 */}
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          {isSelectMode ? (
                            <div className={`w-5 h-5 flex items-center justify-center ${
                              selectedInGroup === totalInGroup ? 'bg-[#1A1A1A]' : selectedInGroup > 0 ? 'bg-[#5C5C5C]' : 'border border-[#5C5C5C]'
                            }`}>
                              {selectedInGroup > 0 && (
                                <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          ) : (
                            <svg
                              className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 그룹 펼침 (공통 지문 + 하위 문제들) */}
                    <AnimatePresence>
                      {isGroupExpanded && !isSelectMode && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="border border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-4">
                            {/* 공통 문제는 아코디언 헤더에 표시되므로 생략 */}

                            {/* 공통 지문 */}
                            {(firstItem.passage || firstItem.passageImage || firstItem.koreanAbcItems || (firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0)) && (() => {
                              // 지문과 이미지가 둘 다 있는지 확인
                              const hasText = firstItem.passage || (firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0) || (firstItem.passageMixedExamples && firstItem.passageMixedExamples.length > 0);
                              const hasImage = !!firstItem.passageImage;
                              const needsInnerBox = hasText && hasImage;

                              return (
                                <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                                  {/* 텍스트 */}
                                  {firstItem.passage && firstItem.passageType !== 'korean_abc' && (
                                    needsInnerBox ? (
                                      <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                                        <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstItem.passage}</p>
                                      </div>
                                    ) : (
                                      <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstItem.passage}</p>
                                    )
                                  )}
                                  {/* ㄱㄴㄷ 형식 */}
                                  {firstItem.passageType === 'korean_abc' && firstItem.koreanAbcItems && firstItem.koreanAbcItems.length > 0 && (
                                    needsInnerBox ? (
                                      <div className="p-3 bg-[#FFFDF7] border border-[#E8D9A8]">
                                        <div className="space-y-1">
                                          {firstItem.koreanAbcItems.map((itm, idx) => (
                                            <p key={idx} className="text-sm text-[#1A1A1A]">
                                              <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="space-y-1">
                                        {firstItem.koreanAbcItems.map((itm, idx) => (
                                          <p key={idx} className="text-sm text-[#1A1A1A]">
                                            <span className="font-bold">{KOREAN_LABELS[idx]}.</span> {itm}
                                          </p>
                                        ))}
                                      </div>
                                    )
                                  )}
                                  {/* 혼합 형식 */}
                                  {(firstItem as any).passageMixedExamples && (firstItem as any).passageMixedExamples.length > 0 && (
                                    <div className="space-y-2">
                                      {(firstItem as any).passageMixedExamples.map((block: any) => (
                                        <div key={block.id}>
                                          {block.type === 'grouped' && (
                                            <div className="space-y-1">
                                              {(block.children || []).map((child: any) => (
                                                <div key={child.id}>
                                                  {child.type === 'text' && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                                                  {child.type === 'labeled' && (child.items || []).map((i: any) => (
                                                    <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                                  ))}
                                                  {child.type === 'gana' && (child.items || []).map((i: any) => (
                                                    <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                                  ))}
                                                  {child.type === 'image' && child.imageUrl && <Image src={child.imageUrl} alt="" width={800} height={400} className="max-w-full h-auto" unoptimized />}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'text' && <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
                                          {block.type === 'labeled' && (
                                            <div className="space-y-1">
                                              {(block.items || []).map((i: any) => (
                                                <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'gana' && (
                                            <div className="space-y-1">
                                              {(block.items || []).map((i: any) => (
                                                <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                              ))}
                                            </div>
                                          )}
                                          {block.type === 'image' && block.imageUrl && <Image src={block.imageUrl} alt="" width={800} height={400} className="max-w-full h-auto" unoptimized />}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* 이미지 */}
                                  {firstItem.passageImage && (
                                    <Image src={firstItem.passageImage} alt="공통 이미지" width={800} height={400} className={`max-w-full max-h-[300px] object-contain border border-[#1A1A1A] ${hasText ? 'mt-3' : ''}`} unoptimized />
                                  )}
                                </div>
                              );
                            })()}

                            {/* 하위 문제들 */}
                            <div className="space-y-2 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
                              {groupItems.map((subItem, subIdx) => (
                                <QuestionCard
                                  key={subItem.id}
                                  item={subItem}
                                  questionNumber={displayItem.displayNumber}
                                  subQuestionNumber={subIdx + 1}
                                  isSelectMode={false}
                                  isSelected={false}
                                  onSelect={() => {}}
                                  onFeedbackSubmit={handleFeedbackSubmit}
                                  currentUserId={user?.uid}
                                  quizCreatorId={quizCreatorsMap.get(subItem.quizId)}
                                  isAiGenerated={quizAiMap.get(subItem.quizId)}
                                  courseId={userCourse?.id}
                                  folderType={folderType}
                                  hasUpdate={updatedQuestionIds.has(subItem.questionId)}
                                  isEditMode={isEditMode}
                                  editData={editedQuestions[subItem.questionId]}
                                  onEditChange={isEditMode ? (field, value) => {
                                    setEditedQuestions(prev => ({
                                      ...prev,
                                      [subItem.questionId]: { ...prev[subItem.questionId], [field]: value }
                                    }));
                                  } : undefined}
                                />
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }

              return null;
            })
          )}
        </main>
      )}

      {/* 하단 버튼 영역 — 선택 모드에서 선택 항목 없으면 숨김 */}
      {!loading && questions.length > 0 && !(isSelectMode && !isAssignMode && selectedIds.size === 0) && (
        <div className="fixed bottom-0 right-0 p-3 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]" style={{ left: 'var(--detail-panel-left, 0)' }}>
          {isEditMode ? (
            /* 수정 모드일 때 - 취소/저장 */
            <div className="flex gap-2">
              <button
                onClick={handleCancelEdit}
                disabled={isSavingEdit}
                className="flex-1 py-3 text-sm font-bold bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <button
                onClick={handleSaveEdits}
                disabled={isSavingEdit || (Object.keys(editedQuestions).length === 0 && !(editedTitle.trim() && editedTitle.trim() !== libraryQuizTitle))}
                className={`flex-1 py-3 text-sm font-bold border-2 transition-colors rounded-lg ${
                  (Object.keys(editedQuestions).length > 0 || (editedTitle.trim() && editedTitle.trim() !== libraryQuizTitle))
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A] hover:bg-[#3A3A3A]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
                }`}
              >
                {isSavingEdit ? '저장 중...' : '저장'}
              </button>
            </div>
          ) : isSelectMode && selectedIds.size > 0 ? (
            /* 선택 모드일 때 - 선택한 문제 복습 */
            <button
              onClick={handleStartPractice}
              className="w-full py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors rounded-lg"
            >
              선택 복습하기 ({selectedIds.size})
            </button>
          ) : !isSelectMode ? (
            /* 기본 모드 - 전체 복습 + 오답 복습 */
            <div className="flex gap-2">
              <button
                onClick={handleStartPractice}
                className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors rounded-lg"
              >
                전체 복습
              </button>
              <button
                onClick={handleStartWrongOnlyPractice}
                disabled={wrongCount === 0}
                className={`flex-1 py-2.5 text-sm font-bold border-2 transition-colors rounded-lg ${
                  wrongCount > 0
                    ? 'bg-[#8B1A1A] text-[#F5F0E8] border-[#8B1A1A] hover:bg-[#6B1414]'
                    : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
                }`}
              >
                오답 복습 {wrongCount > 0 && `(${wrongCount})`}
              </button>
            </div>
          ) : null}
        </div>
      )}


      {/* 배정 모드일 때 하단 안내 */}
      {!loading && isAssignMode && isSelectMode && selectedIds.size === 0 && (
        <div className="fixed bottom-0 right-0 p-3 bg-[#EDEAE4] border-t-2 border-[#1A1A1A]" style={{ left: 'var(--detail-panel-left, 0)' }}>
          <p className="text-xs text-center text-[#5C5C5C]">
            분류할 문제를 선택하세요
          </p>
        </div>
      )}

      {/* 빈 폴더 임시 메시지 */}
      <AnimatePresence>
        {showEmptyMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-[#F5F0E8] border-2 border-[#1A1A1A] px-6 py-4 text-center"
            >
              <p className="text-sm font-bold text-[#1A1A1A]">
                선택된 폴더에 복습할 문제가 없습니다
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 토스트 메시지 */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-28 right-4 z-50"
            style={{ left: 'max(1rem, var(--detail-panel-left, 1rem))' }}
          >
            <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3 text-center border-2 border-[#1A1A1A]">
              <p className="text-sm font-bold">{toastMessage}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 카테고리 관리 바텀시트 */}
      <BottomSheet
        isOpen={isCategoryMode}
        onClose={() => {
          setIsCategoryMode(false);
          setNewCategoryName('');
        }}
        title="정렬 기준 관리"
        height="auto"
      >
        <div className="space-y-4">
          {/* 카테고리 추가 */}
          <div>
            <label className="block text-sm text-[#5C5C5C] mb-2">새 분류 추가</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="분류 이름 입력"
                className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
                maxLength={20}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCategoryName.trim()) {
                    handleAddCategory();
                  }
                }}
              />
              <button
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim()}
                className="px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm disabled:opacity-30"
              >
                추가
              </button>
            </div>
          </div>

          {/* 현재 카테고리 목록 */}
          <div>
            <label className="block text-sm text-[#5C5C5C] mb-2">
              현재 분류 ({customFolder?.categories?.length || 0}개)
            </label>
            {!customFolder?.categories?.length ? (
              <p className="text-xs text-[#5C5C5C] py-4 text-center border border-dashed border-[#5C5C5C]">
                아직 분류가 없습니다. 위에서 추가해주세요.
              </p>
            ) : (
              <div className="space-y-2">
                {customFolder.categories.map((cat) => {
                  const questionCount = customFolder.questions.filter(
                    (q: CustomFolderQuestion) => q.categoryId === cat.id
                  ).length;

                  return (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between p-3 border border-[#1A1A1A] bg-[#EDEAE4]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#1A1A1A]">{cat.name}</span>
                        <span className="text-xs text-[#5C5C5C]">({questionCount}문제)</span>
                      </div>
                      <button
                        onClick={() => handleRemoveCategory(cat.id)}
                        className="px-2 py-1 text-xs text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 문제 배정 모드 진입 버튼 */}
          {customFolder?.categories?.length ? (
            <div className="pt-2 border-t border-[#EDEAE4]">
              <button
                onClick={() => {
                  setIsCategoryMode(false);
                  setIsSelectMode(true);
                  setIsDeleteMode(false);
                  setIsAssignMode(true);
                }}
                className="w-full py-3 font-bold text-sm bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
              >
                문제 분류하기
              </button>
              <p className="text-xs text-[#5C5C5C] text-center mt-2">
                문제를 선택한 후 원하는 분류에 배정할 수 있습니다.
              </p>
            </div>
          ) : null}
        </div>
      </BottomSheet>

      {/* 문제 배정 바텀시트 (문제 선택 후 카테고리 선택) */}
      <BottomSheet
        isOpen={isAssignMode && isSelectMode && selectedIds.size > 0}
        onClose={() => {
          setSelectedCategoryForAssign(null);
        }}
        title={`${selectedIds.size}개 문제 분류`}
        height="auto"
      >
        <div className="space-y-3">
          <p className="text-sm text-[#5C5C5C]">분류를 선택하세요</p>

          {/* 카테고리 선택 버튼들 */}
          <div className="space-y-2">
            {customFolder?.categories?.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryForAssign(cat.id)}
                className={`w-full p-3 text-left font-bold text-sm border-2 transition-colors ${
                  selectedCategoryForAssign === cat.id
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4]'
                }`}
              >
                {cat.name}
              </button>
            ))}
            {/* 미분류 옵션 */}
            <button
              onClick={() => setSelectedCategoryForAssign('uncategorized')}
              className={`w-full p-3 text-left font-bold text-sm border-2 transition-colors ${
                selectedCategoryForAssign === 'uncategorized'
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#5C5C5C] border-[#5C5C5C] border-dashed hover:bg-[#EDEAE4]'
              }`}
            >
              미분류
            </button>
          </div>

          {/* 배정 버튼 */}
          <button
            onClick={async () => {
              if (!selectedCategoryForAssign) return;
              const categoryId = selectedCategoryForAssign === 'uncategorized' ? null : selectedCategoryForAssign;

              try {
                for (const itemId of selectedIds) {
                  const item = questions.find(q => q.id === itemId);
                  if (item) {
                    await assignQuestionToCategory(folderId, item.questionId, categoryId);
                  }
                }
                setSelectedIds(new Set());
                setIsSelectMode(false);
                setIsAssignMode(false);
                setSelectedCategoryForAssign(null);
              } catch (err) {
                console.error('배정 실패:', err);
                alert('배정에 실패했습니다.');
              }
            }}
            disabled={!selectedCategoryForAssign}
            className="w-full py-3 font-bold text-sm bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-30 transition-colors"
          >
            배정하기
          </button>
        </div>
      </BottomSheet>

      {/* 폴더/서재 삭제 확인 모달 */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowDeleteModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[85%] max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-2xl"
          >
            <div className="flex justify-center mb-3">
              <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                <svg className="w-5 h-5 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <h3 className="text-center font-bold text-base text-[#1A1A1A] mb-2">
              {folderType === 'custom' ? '폴더를 삭제할까요?' : '퀴즈를 삭제할까요?'}
            </h3>
            <p className="text-xs text-[#5C5C5C] mb-1">
              {folderType === 'custom'
                ? '- 삭제된 폴더는 복구할 수 없습니다.'
                : '- 삭제된 퀴즈는 복구할 수 없습니다.'
              }
            </p>
            <p className="text-xs text-[#5C5C5C] mb-5">
              {folderType === 'custom'
                ? '- 폴더 안의 문제는 원본에 남아있습니다.'
                : '- 이미 푼 사람은 복습 가능합니다.'
              }
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2.5 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  try {
                    if (folderType === 'custom') {
                      await deleteCustomFolder(folderId);
                    } else if (folderType === 'library') {
                      await deleteDoc(doc(db, 'quizzes', folderId));
                    }
                    setShowDeleteModal(false);
                    router.push(`/review?filter=${folderType}`);
                  } catch (err) {
                    console.error('삭제 실패:', err);
                  }
                }}
                className="flex-1 py-2.5 font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors rounded-lg"
              >
                삭제
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
