'use client';

import { motion } from 'framer-motion';

/**
 * 온보딩 단계 정보 타입
 */
export interface OnboardingStep {
  // 단계 번호 (1부터 시작)
  step: number;
  // 단계 이름
  label: string;
  // 경로
  path: string;
}

/**
 * 온보딩 단계 목록
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  { step: 1, label: '학적정보', path: '/onboarding/student-info' },
  { step: 2, label: '캐릭터', path: '/onboarding/character' },
  { step: 3, label: '닉네임', path: '/onboarding/nickname' },
  { step: 4, label: '튜토리얼', path: '/onboarding/tutorial' },
];

/**
 * StepIndicator Props
 */
interface StepIndicatorProps {
  // 현재 단계 (1부터 시작)
  currentStep: number;
  // 총 단계 수
  totalSteps?: number;
}

/**
 * 온보딩 단계 표시기 컴포넌트
 * 현재 진행 상황을 시각적으로 보여줍니다.
 *
 * @example
 * <StepIndicator currentStep={2} />
 */
export default function StepIndicator({
  currentStep,
  totalSteps = 4,
}: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: totalSteps }, (_, index) => {
        const stepNumber = index + 1;
        const isCompleted = stepNumber < currentStep;
        const isCurrent = stepNumber === currentStep;

        return (
          <div key={stepNumber} className="flex items-center">
            {/* 단계 원형 아이콘 */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: index * 0.1 }}
              className={`
                relative flex items-center justify-center
                w-8 h-8 rounded-full
                text-sm font-semibold
                transition-all duration-300
                ${isCompleted
                  ? 'bg-green-500 text-white'
                  : isCurrent
                    ? 'bg-[var(--theme-accent)] text-white shadow-lg shadow-[var(--theme-accent)]/30'
                    : 'bg-gray-200 text-gray-400'
                }
              `}
            >
              {isCompleted ? (
                // 완료된 단계: 체크 아이콘
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                // 현재/대기 단계: 숫자
                stepNumber
              )}

            </motion.div>

            {/* 단계 사이 연결선 */}
            {stepNumber < totalSteps && (
              <div className="relative w-8 h-0.5 mx-1">
                {/* 배경선 */}
                <div className="absolute inset-0 bg-gray-200 rounded-full" />
                {/* 진행선 */}
                <motion.div
                  className="absolute inset-0 bg-green-500 rounded-full origin-left"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: isCompleted ? 1 : 0 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 현재 단계 텍스트 레이블 컴포넌트
 */
export function StepLabel({ currentStep }: { currentStep: number }) {
  const step = ONBOARDING_STEPS.find((s) => s.step === currentStep);

  return (
    <div className="text-center mb-2">
      <p className="text-sm text-[var(--theme-text-secondary)]">
        {currentStep}단계 / {ONBOARDING_STEPS.length}단계
      </p>
      {step && (
        <p className="text-lg font-semibold text-[var(--theme-text)]">
          {step.label}
        </p>
      )}
    </div>
  );
}
