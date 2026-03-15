'use client';

import Image from 'next/image';

/** 폴더 상세 페이지 상단 헤더 (리본 이미지 + solved 점수 표시) */
export interface FolderDetailHeaderProps {
  /** 리본 이미지 경로 */
  ribbonImage: string;
  /** 리본 스케일 */
  ribbonScale: number;
  /** 폴더 타입 */
  folderType: string;
  /** 폴더 제목 */
  folderTitle: string;
  /** 퀴즈 페이지에서 접근했는지 여부 */
  fromQuizPage: boolean;
  /** 퀴즈 점수 데이터 (solved/bookmark/library) */
  quizScores: {
    myScore?: number;
    myFirstReviewScore?: number;
    averageScore?: number;
    isPublic?: boolean;
  } | null;
  /** 뒤로가기 핸들러 */
  onBack: () => void;
}

/**
 * 리본 이미지 배너 + solved 타입일 때 점수 영역을 포함하는 헤더 컴포넌트
 */
export default function FolderDetailHeader({
  ribbonImage,
  ribbonScale,
  folderType,
  folderTitle,
  fromQuizPage,
  quizScores,
  onBack,
}: FolderDetailHeaderProps) {
  return (
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
                onClick={onBack}
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
  );
}
