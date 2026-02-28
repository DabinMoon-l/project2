'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useExpToast } from '@/components/common';
import { useUser } from '@/lib/contexts';

/**
 * 문제 결과 타입
 */
interface QuestionResult {
  id: string;
  isCorrect: boolean;
}

/**
 * EXP 상세 정보 타입
 */
interface ExpInfo {
  baseExp: number;        // 기본 EXP
  bonusExp: number;       // 성적 보너스 EXP
  feedbackExp: number;    // 피드백 EXP
  totalExp: number;       // 총 획득 EXP
  score: number;          // 점수 (0-100)
  correctCount: number;   // 맞은 문제 수
  totalCount: number;     // 총 문제 수
  hasFeedback: boolean;   // 피드백 제출 여부
  isOwnQuiz: boolean;     // 자기가 만든 퀴즈인지
}

/**
 * EXP 상세 정보 페이지
 *
 * 퀴즈 완료 후 획득할 EXP 상세 정보를 표시합니다.
 */
export default function ExpPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();

  const quizId = params.id as string;

  const [expInfo, setExpInfo] = useState<ExpInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * EXP 정보 계산 및 로드
   */
  const loadExpInfo = useCallback(async () => {
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
      const isOwnQuiz = quizData.creatorId === user.uid;

      // 로컬 스토리지에서 결과 데이터 가져오기
      const storedResult = localStorage.getItem(`quiz_result_${quizId}`);
      let correctCount = 0;
      let totalCount = 0;
      let questionResults: QuestionResult[] = [];

      if (storedResult) {
        try {
          const resultJson = JSON.parse(storedResult);
          questionResults = resultJson.questionResults || [];
          correctCount = resultJson.correctCount || 0;
          totalCount = resultJson.totalCount || 0;
        } catch (e) {
          console.error('결과 데이터 파싱 오류:', e);
        }
      }

      // 퀴즈 결과에서 점수 가져오기 (fallback)
      if (totalCount === 0) {
        const resultsQuery = query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid),
          where('quizId', '==', quizId)
        );
        const resultsSnapshot = await getDocs(resultsQuery);
        if (!resultsSnapshot.empty) {
          const resultData = resultsSnapshot.docs[0].data();
          correctCount = resultData.correctCount || 0;
          totalCount = resultData.totalCount || quizData.questions?.length || 1;
        }
      }

      // 점수 계산
      const score = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

      // 기본 EXP: 25 XP (참여 보상)
      const baseExp = 25;

      // 성적 보너스 EXP (Cloud Function과 동일한 로직)
      let bonusExp = 0;
      if (score === 100) bonusExp = 25; // 총 50
      else if (score >= 90) bonusExp = 15; // 총 40
      else if (score >= 70) bonusExp = 10; // 총 35
      else if (score >= 50) bonusExp = 5; // 총 30

      // 피드백 EXP (자기 퀴즈면 0, 피드백 1개당 10)
      const hasFeedback = localStorage.getItem(`quiz_feedback_${quizId}`) === 'true';
      const feedbackExp = isOwnQuiz ? 0 : (hasFeedback ? 10 : 0);

      const totalExp = baseExp + bonusExp + feedbackExp;

      setExpInfo({
        baseExp,
        bonusExp,
        feedbackExp,
        totalExp,
        score,
        correctCount,
        totalCount,
        hasFeedback,
        isOwnQuiz,
      });
    } catch (err) {
      console.error('EXP 정보 로드 오류:', err);
      setError('EXP 정보를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [user, quizId]);

  // 데이터 로드
  useEffect(() => {
    loadExpInfo();
  }, [loadExpInfo]);

  /**
   * 완료 버튼 클릭 핸들러
   *
   * 참고: 경험치 지급은 Firestore 트리거(onQuizComplete, onFeedbackSubmit)로 처리됨
   * 여기서는 EXP 토스트 표시 및 로컬 스토리지 정리만 수행
   */
  const handleComplete = async () => {
    if (!expInfo || !user || isCompleting) return;

    try {
      setIsCompleting(true);

      // EXP 토스트 표시
      showExpToast(expInfo.totalExp, '퀴즈 완료');

      // 로컬 스토리지 정리
      localStorage.removeItem(`quiz_answers_${quizId}`);
      localStorage.removeItem(`quiz_result_${quizId}`);
      localStorage.removeItem(`quiz_feedback_${quizId}`);

      // 퀴즈 목록으로 이동
      router.push('/quiz');
    } catch (err) {
      console.error('완료 처리 오류:', err);
      setError('완료 처리 중 오류가 발생했습니다.');
    } finally {
      setIsCompleting(false);
    }
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
  if (error || !expInfo) {
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

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-50 px-4 py-3 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
        <div className="flex items-center justify-center">
          <h1 className="text-sm font-bold text-[#1A1A1A]">
            획득 경험치
          </h1>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 px-4 py-4">
        {/* 점수 표시 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-4"
        >
          <div className="inline-block px-4 py-2.5 bg-[#F5F0E8] border-2 border-[#1A1A1A]">
            <p className="text-xs text-[#5C5C5C] mb-0.5">퀴즈 점수</p>
            <p className="text-2xl font-bold text-[#1A1A1A]">{expInfo.score}점</p>
            <p className="text-[10px] text-[#5C5C5C] mt-0.5">
              {expInfo.correctCount} / {expInfo.totalCount} 문제 정답
            </p>
          </div>
        </motion.div>

        {/* EXP 상세 정보 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-3"
        >
          {/* 기본 EXP */}
          <div className="flex justify-between items-center p-2.5 bg-[#EDEAE4] border border-[#1A1A1A]">
            <div>
              <p className="text-xs font-bold text-[#1A1A1A]">퀴즈 풀이 기본</p>
              <p className="text-[10px] text-[#5C5C5C]">퀴즈 완료 보상</p>
            </div>
            <span className="text-sm font-bold text-[#1A1A1A]">+{expInfo.baseExp} XP</span>
          </div>

          {/* 성적 보너스 EXP */}
          <div className="flex justify-between items-center p-2.5 bg-[#EDEAE4] border border-[#1A1A1A]">
            <div>
              <p className="text-xs font-bold text-[#1A1A1A]">성적 보너스</p>
              <p className="text-[10px] text-[#5C5C5C]">
                {expInfo.score === 100 ? '만점!' :
                 expInfo.score >= 90 ? '90점 이상' :
                 expInfo.score >= 70 ? '70점 이상' :
                 expInfo.score >= 50 ? '50점 이상' : '50점 미만'}
              </p>
            </div>
            <span className={`text-sm font-bold ${expInfo.bonusExp > 0 ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'}`}>
              +{expInfo.bonusExp} XP
            </span>
          </div>

          {/* 피드백 EXP */}
          <div className="flex justify-between items-center p-2.5 bg-[#EDEAE4] border border-[#1A1A1A]">
            <div>
              <p className="text-xs font-bold text-[#1A1A1A]">피드백 보너스</p>
              <p className="text-[10px] text-[#5C5C5C]">
                {expInfo.isOwnQuiz ? '자신의 퀴즈' :
                 expInfo.hasFeedback ? '피드백 제출 완료' : '피드백 미제출'}
              </p>
            </div>
            <span className={`text-sm font-bold ${expInfo.feedbackExp > 0 ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'}`}>
              +{expInfo.feedbackExp} XP
            </span>
          </div>

          {/* 구분선 */}
          <div className="border-t-2 border-[#1A1A1A] my-3" />

          {/* 총 EXP */}
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
            className="flex justify-between items-center p-3 bg-[#1A1A1A] text-[#F5F0E8]"
          >
            <p className="text-sm font-bold">총 획득 경험치</p>
            <span className="text-base font-bold">+{expInfo.totalExp} XP</span>
          </motion.div>
        </motion.div>
      </main>

      {/* 하단 버튼 */}
      <div className="px-4 py-3 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
        <button
          onClick={handleComplete}
          disabled={isCompleting}
          className="w-full py-2.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isCompleting ? (
            <>
              <div className="w-4 h-4 border-2 border-[#F5F0E8] border-t-transparent animate-spin" />
              처리 중...
            </>
          ) : (
            '완료'
          )}
        </button>
      </div>
    </div>
  );
}
