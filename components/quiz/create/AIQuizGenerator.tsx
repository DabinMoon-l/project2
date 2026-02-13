'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

// ============================================================
// 타입 정의
// ============================================================

interface GeminiUsage {
  userUsed: number;
  userLimit: number;
  userRemaining: number;
  totalUsed: number;
  totalLimit: number;
  totalRemaining: number;
}

interface GeneratedQuestion {
  text: string;
  choices: string[];
  answer: number;
  explanation: string;
}

interface GeminiResult {
  success: boolean;
  questions: GeneratedQuestion[];
  usage: {
    userUsed: number;
    userLimit: number;
    userRemaining: number;
  };
}

interface QueueResult {
  queueId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'none';
  position?: number;
  message?: string;
  result?: GeneratedQuestion[];
  error?: string;
  createdAt?: string;
  completedAt?: string;
}

interface AIQuizGeneratorProps {
  /** 처리할 파일 */
  file: File | null;
  /** 생성 완료 시 콜백 */
  onComplete: (questions: GeneratedQuestion[]) => void;
  /** 에러 발생 시 콜백 */
  onError?: (error: string) => void;
  /** 취소 시 콜백 */
  onCancel?: () => void;
  /** 큐잉 시작 시 콜백 (페이지 이동 가능 알림) */
  onQueueStarted?: (queueId: string) => void;
  /** 추가 클래스명 */
  className?: string;
}

// localStorage 키
const QUEUE_ID_KEY = 'gemini_queue_id';

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 파일을 base64로 변환
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * AI 퀴즈 생성 컴포넌트
 *
 * Google Gemini API를 사용하여 교재 이미지에서 객관식 문제를 생성합니다.
 * 큐잉 시스템으로 동시 요청 처리, 페이지를 떠나도 백그라운드에서 처리 계속
 */
export default function AIQuizGenerator({
  file,
  onComplete,
  onError,
  onCancel,
  onQueueStarted,
  className = '',
}: AIQuizGeneratorProps) {
  // 상태
  const [isGenerating, setIsGenerating] = useState(false);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [usage, setUsage] = useState<GeminiUsage | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [progress, setProgress] = useState<{ status: string; percent: number } | null>(null);

  // 큐 상태
  const [queueId, setQueueId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueResult | null>(null);
  const [isCheckingQueue, setIsCheckingQueue] = useState(false);

  // 취소 플래그
  const isCancelledRef = useRef(false);
  const processedFileRef = useRef<File | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * 사용량 로드
   */
  const loadUsage = useCallback(async () => {
    setIsLoadingUsage(true);
    try {
      const getGeminiUsage = httpsCallable<void, GeminiUsage>(
        functions,
        'getGeminiUsage'
      );
      const result = await getGeminiUsage();
      setUsage(result.data);
    } catch (error) {
      console.error('사용량 조회 오류:', error);
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  /**
   * 큐 상태 확인
   */
  const checkQueueStatus = useCallback(async (id: string) => {
    try {
      const checkStatus = httpsCallable<{ queueId: string }, QueueResult>(
        functions,
        'checkGeminiQueueStatus'
      );
      const result = await checkStatus({ queueId: id });
      setQueueStatus(result.data);

      // 완료된 경우
      if (result.data.status === 'completed' && result.data.result) {
        // 폴링 중지
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }

        // 결과 수령
        const claimResult = httpsCallable<{ queueId: string }, { success: boolean; questions: GeneratedQuestion[] }>(
          functions,
          'claimGeminiQueueResult'
        );
        const claimed = await claimResult({ queueId: id });

        // localStorage 정리
        localStorage.removeItem(QUEUE_ID_KEY);
        setQueueId(null);
        setQueueStatus(null);
        setIsGenerating(false);

        // 사용량 새로고침
        loadUsage();

        // 결과 전달
        onComplete(claimed.data.questions);
      }

      // 실패한 경우
      if (result.data.status === 'failed') {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }

        localStorage.removeItem(QUEUE_ID_KEY);
        setQueueId(null);
        setQueueStatus(null);
        setIsGenerating(false);

        onError?.(result.data.error || 'AI 문제 생성에 실패했습니다.');
      }

      return result.data;
    } catch (error) {
      console.error('큐 상태 확인 오류:', error);
      return null;
    }
  }, [loadUsage, onComplete, onError]);

  /**
   * 폴링 시작
   */
  const startPolling = useCallback((id: string) => {
    // 기존 폴링 중지
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // 즉시 한 번 체크
    checkQueueStatus(id);

    // 10초마다 폴링
    pollingIntervalRef.current = setInterval(() => {
      checkQueueStatus(id);
    }, 10000);
  }, [checkQueueStatus]);

  /**
   * 컴포넌트 마운트 시 저장된 큐 ID 확인
   */
  useEffect(() => {
    const savedQueueId = localStorage.getItem(QUEUE_ID_KEY);
    if (savedQueueId) {
      setQueueId(savedQueueId);
      setIsCheckingQueue(true);
      setIsGenerating(true);

      // 저장된 큐 상태 확인
      checkQueueStatus(savedQueueId).then((status) => {
        setIsCheckingQueue(false);

        if (status && (status.status === 'pending' || status.status === 'processing')) {
          // 아직 처리 중이면 폴링 시작
          startPolling(savedQueueId);
        } else if (!status || status.status === 'none') {
          // 큐가 없으면 정리
          localStorage.removeItem(QUEUE_ID_KEY);
          setQueueId(null);
          setIsGenerating(false);
        }
      });
    }

    // 클린업
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [checkQueueStatus, startPolling]);

  /**
   * 파일 변경 시 사용량 로드
   */
  useEffect(() => {
    if (file && file !== processedFileRef.current) {
      processedFileRef.current = file;
      isCancelledRef.current = false;
      if (!queueId) {
        loadUsage();
      }
    }
  }, [file, loadUsage, queueId]);

  /**
   * 취소 핸들러
   */
  const handleCancel = useCallback(() => {
    isCancelledRef.current = true;

    // 폴링 중지
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // 큐 ID 정리 (백그라운드 처리는 계속됨, 결과만 무시)
    localStorage.removeItem(QUEUE_ID_KEY);
    setQueueId(null);
    setQueueStatus(null);
    setIsGenerating(false);
    setProgress(null);

    onCancel?.();
  }, [onCancel]);

  /**
   * AI 문제 생성 (큐 사용)
   */
  const handleGenerate = useCallback(async () => {
    if (!file) return;

    // 사용량 확인
    if (usage && usage.userRemaining <= 0) {
      onError?.('오늘의 AI 문제 생성 횟수를 모두 사용했습니다. 내일 다시 시도해주세요.');
      return;
    }

    setIsGenerating(true);
    isCancelledRef.current = false;
    setProgress({ status: '이미지 준비 중...', percent: 10 });

    try {
      // 이미지를 base64로 변환
      const base64Image = await fileToBase64(file);

      if (isCancelledRef.current) return;

      setProgress({ status: '요청을 큐에 추가하는 중...', percent: 30 });

      // 큐에 추가
      const addToQueue = httpsCallable<
        { image: string; difficulty: string },
        QueueResult
      >(functions, 'addToGeminiQueue');

      const result = await addToQueue({
        image: base64Image,
        difficulty,
      });

      if (isCancelledRef.current) return;

      const newQueueId = result.data.queueId;
      setQueueId(newQueueId);
      setQueueStatus(result.data);

      // localStorage에 저장 (페이지 이동 후에도 확인 가능)
      localStorage.setItem(QUEUE_ID_KEY, newQueueId);

      // 콜백 호출
      onQueueStarted?.(newQueueId);

      setProgress({
        status: result.data.position && result.data.position > 1
          ? `대기 순서: ${result.data.position}번째`
          : '처리 중...',
        percent: 50,
      });

      // 폴링 시작
      startPolling(newQueueId);
    } catch (error: any) {
      if (isCancelledRef.current) return;

      let errorMessage = 'AI 문제 생성 중 오류가 발생했습니다.';

      if (error.code === 'functions/resource-exhausted') {
        errorMessage = error.message || '사용량 한도를 초과했습니다.';
      } else if (error.code === 'functions/failed-precondition') {
        errorMessage = 'AI 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.';
      } else if (error.code === 'functions/unauthenticated') {
        errorMessage = '로그인이 필요합니다.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      console.error('AI 생성 오류:', error);
      setIsGenerating(false);
      setProgress(null);
      onError?.(errorMessage);
    }
  }, [file, difficulty, usage, onComplete, onError, onQueueStarted, startPolling]);

  // 파일이 없고 큐도 없으면 렌더링하지 않음
  if (!file && !queueId) {
    return null;
  }

  const difficultyOptions = [
    { value: 'easy', label: '쉬움', desc: '기본 개념 확인' },
    { value: 'medium', label: '보통', desc: '응용력 테스트' },
    { value: 'hard', label: '어려움', desc: '심화 분석' },
  ] as const;

  // 큐 대기 중인 경우 UI
  if (queueId && (isCheckingQueue || queueStatus)) {
    return (
      <div className={`space-y-4 ${className}`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#F5F0E8] p-6 border-2 border-[#1A1A1A]"
        >
          {/* AI 아이콘 */}
          <div className="flex justify-center mb-4">
            <motion.div
              animate={{
                scale: [1, 1.1, 1],
                rotate: [0, 5, -5, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className="w-16 h-16 bg-[#1A1A1A] flex items-center justify-center"
            >
              <svg className="w-10 h-10 text-[#F5F0E8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </motion.div>
          </div>

          {/* 상태 표시 */}
          <div className="text-center mb-4">
            {isCheckingQueue ? (
              <>
                <p className="font-serif-display text-xl font-black text-[#1A1A1A]">
                  상태 확인 중...
                </p>
              </>
            ) : queueStatus?.status === 'pending' ? (
              <>
                <p className="font-serif-display text-xl font-black text-[#1A1A1A]">
                  대기 중
                </p>
                <p className="text-sm text-[#5C5C5C] mt-1">
                  {queueStatus.position && queueStatus.position > 1
                    ? `대기 순서: ${queueStatus.position}번째`
                    : '곧 처리됩니다'}
                </p>
                <p className="text-xs text-[#5C5C5C] mt-2">
                  예상 대기 시간: 약 {((queueStatus.position || 1) * 1)}분
                </p>
              </>
            ) : queueStatus?.status === 'processing' ? (
              <>
                <p className="font-serif-display text-xl font-black text-[#1A1A1A]">
                  AI가 문제를 생성하고 있습니다
                </p>
                <p className="text-sm text-[#5C5C5C] mt-1">
                  잠시만 기다려주세요...
                </p>
              </>
            ) : null}
          </div>

          {/* 진행 표시 */}
          <div className="flex justify-center gap-2 mb-4">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.2,
                }}
                className="w-3 h-3 bg-[#1A1A1A]"
              />
            ))}
          </div>

          {/* 안내 메시지 */}
          <div className="bg-[#E8F5E9] border border-[#1A6B1A] p-3 mb-4">
            <p className="text-xs text-[#1A6B1A] text-center">
              💡 페이지를 떠나도 백그라운드에서 처리가 계속됩니다.<br />
              나중에 다시 돌아오면 결과를 확인할 수 있습니다.
            </p>
          </div>

          {/* 취소 버튼 */}
          <button
            type="button"
            onClick={handleCancel}
            className="w-full py-2 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors"
          >
            취소
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 사용량 표시 */}
      {!isGenerating && (
        <div className="bg-[#F5F0E8] p-4 border-2 border-[#1A1A1A]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-[#1A1A1A]">오늘의 AI 생성 횟수</span>
            {isLoadingUsage ? (
              <span className="text-sm text-[#5C5C5C]">로딩중...</span>
            ) : usage ? (
              <span
                className={`text-sm font-bold ${
                  usage.userRemaining <= 2 ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'
                }`}
              >
                {usage.userUsed} / {usage.userLimit}
              </span>
            ) : (
              <span className="text-sm text-[#5C5C5C]">-</span>
            )}
          </div>
          {usage && (
            <div className="w-full h-2 bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden">
              <div
                className={`h-full ${usage.userRemaining <= 2 ? 'bg-[#8B1A1A]' : 'bg-[#1A1A1A]'}`}
                style={{ width: `${(usage.userUsed / usage.userLimit) * 100}%` }}
              />
            </div>
          )}
          {usage && usage.userRemaining <= 2 && (
            <p className="text-xs text-[#8B1A1A] mt-2">
              남은 횟수: {usage.userRemaining}회
            </p>
          )}
        </div>
      )}

      {/* 난이도 선택 */}
      {!isGenerating && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-[#1A1A1A]">난이도 선택</p>
          <div className="grid grid-cols-3 gap-2">
            {difficultyOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDifficulty(opt.value)}
                className={`
                  p-3 text-center border-2 transition-colors
                  ${
                    difficulty === opt.value
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#EDEAE4]'
                  }
                `}
              >
                <p className="font-bold text-sm">{opt.label}</p>
                <p
                  className={`text-xs mt-1 ${
                    difficulty === opt.value ? 'text-[#D4CFC4]' : 'text-[#5C5C5C]'
                  }`}
                >
                  {opt.desc}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 생성 버튼 */}
      {!isGenerating && (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!usage || usage.userRemaining <= 0}
          className={`
            w-full py-4 text-sm font-bold border-2 transition-colors
            flex items-center justify-center gap-2
            ${
              !usage || usage.userRemaining <= 0
                ? 'bg-[#EDEAE4] text-[#5C5C5C] border-[#D4CFC4] cursor-not-allowed'
                : 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A] hover:bg-[#333]'
            }
          `}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          AI로 객관식 5문제 생성
        </button>
      )}

      {/* 안내 문구 */}
      {!isGenerating && (
        <p className="text-xs text-[#5C5C5C] text-center">
          교재/강의자료 이미지를 기반으로 AI가 객관식 문제를 생성합니다.
          <br />
          <span className="text-[#1A6B1A]">요청 후 페이지를 떠나도 백그라운드에서 처리됩니다.</span>
        </p>
      )}

      {/* 진행 상태 (초기 업로드 중) */}
      <AnimatePresence>
        {isGenerating && progress && !queueId && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-[#F5F0E8] p-6 border-2 border-[#1A1A1A]"
          >
            {/* AI 아이콘 */}
            <div className="flex justify-center mb-4">
              <motion.div
                animate={{
                  scale: [1, 1.1, 1],
                  rotate: [0, 5, -5, 0],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                className="w-16 h-16 bg-[#1A1A1A] flex items-center justify-center"
              >
                <svg className="w-10 h-10 text-[#F5F0E8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </motion.div>
            </div>

            {/* 상태 텍스트 */}
            <div className="text-center mb-4">
              <p className="font-serif-display text-xl font-black text-[#1A1A1A]">
                요청 접수 중
              </p>
              <p className="text-sm text-[#5C5C5C] mt-1">{progress.status}</p>
            </div>

            {/* 진행률 바 */}
            <div className="relative h-2 bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress.percent}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="absolute left-0 top-0 h-full bg-[#1A1A1A]"
              />
            </div>

            {/* 퍼센트 */}
            <p className="text-center text-sm font-bold text-[#1A1A1A] mt-2">
              {progress.percent}%
            </p>

            {/* 취소 버튼 */}
            <button
              type="button"
              onClick={handleCancel}
              className="w-full mt-4 py-2 text-sm font-bold border border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              취소
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
