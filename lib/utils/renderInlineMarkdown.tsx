/**
 * 인라인 마크다운 렌더링 유틸리티
 *
 * 선지/문제 텍스트에서 서식 문법을 지원합니다.
 * - *이탤릭*  → <em>이탤릭</em>
 * - {아래첨자} → <sub>아래첨자</sub>  (예: CO{2} → CO₂)
 * - ^위첨자^ → <sup>위첨자</sup>  (예: m^2^ → m²)
 */

import { Fragment, type ReactNode } from 'react';

/**
 * 인라인 서식 변환
 * *text* → <em>, {text} → <sub>, ^text^ → <sup>
 */
export function renderInlineMarkdown(text: string): ReactNode {
  if (!text || (!text.includes('*') && !text.includes('{') && !text.includes('^'))) return text;

  // *...* | {...} | ^...^ 패턴 매칭
  const parts = text.split(/(\*[^*]+\*|\{[^}]+\}|\^[^^]+\^)/g);

  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('{') && part.endsWith('}') && part.length > 2) {
      return <sub key={i}>{part.slice(1, -1)}</sub>;
    }
    if (part.startsWith('^') && part.endsWith('^') && part.length > 2) {
      return <sup key={i}>{part.slice(1, -1)}</sup>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
