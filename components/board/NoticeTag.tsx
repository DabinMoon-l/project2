'use client';

/**
 * 공지사항 태그 컴포넌트
 *
 * 게시글이 공지사항임을 표시하는 작은 태그입니다.
 */
export default function NoticeTag() {
  return (
    <span
      className="
        inline-flex items-center
        px-2 py-0.5
        text-xs font-semibold
        bg-red-500 text-white
        rounded
      "
    >
      공지
    </span>
  );
}
