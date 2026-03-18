'use client';

/**
 * 복습 피드백(완료) 화면 — ReviewPractice에서 분리된 피드백 단계 컴포넌트
 * 모든 상태는 부모(ReviewPractice)에서 관리하며, props로만 받습니다.
 */

import { motion } from 'framer-motion';
import type { FeedbackStageProps } from '../reviewPracticeTypes';

export default function FeedbackStage({
  // 데이터
  wrongItems,
  correctCount,
  totalQuestionCount,
  headerTitle,
  chapterGroupedWrongItems,
  totalDisplayExp,
  // 폴더 저장 관련
  customFolders,
  selectedFolderId,
  setSelectedFolderId,
  newFolderName,
  setNewFolderName,
  isCreatingFolder,
  handleCreateFolder,
  isSaving,
  handleSaveToFolder,
  saveSuccess,
  // 액션
  onBackToResult,
  onFinish,
  isFinishing,
}: FeedbackStageProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex flex-col overscroll-contain"
      style={{ backgroundColor: '#F5F0E8', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
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
            onClick={onBackToResult}
            className="flex-1 py-3 text-sm bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
          >
            이전
          </button>
          <button
            onClick={onFinish}
            disabled={isFinishing}
            className="flex-[2] py-3 text-sm bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg disabled:opacity-50"
          >
            {isFinishing ? '저장 중...' : '완료'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
