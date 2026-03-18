/**
 * 인라인 마크다운 렌더링 유틸리티
 *
 * 선지/문제 텍스트에서 *이탤릭* 문법을 지원합니다.
 * 예: "*Escherichia coli*는 세균이다" → <em>Escherichia coli</em>는 세균이다
 */

import { Fragment, type ReactNode } from 'react';

/**
 * *text* → <em>text</em> 변환
 * 중첩/복합 마크다운은 지원하지 않음 (선지용 경량 파서)
 */
export function renderInlineMarkdown(text: string): ReactNode {
  if (!text || !text.includes('*')) return text;

  // *...* 패턴 매칭 (단일 *, 줄바꿈 미포함)
  const parts = text.split(/(\*[^*]+\*)/g);

  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
