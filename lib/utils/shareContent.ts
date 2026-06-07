// 공유용 콘텐츠 가공 유틸
// - 마크다운/앱 커스텀 서식 기호를 제거해 읽기 좋은 평문으로 변환
// - 이미지 URL을 navigator.share 의 files 로 첨부할 수 있게 File 객체로 변환

/** 마크다운 및 앱 커스텀 서식 기호 제거 → 평문 */
export function stripMarkdown(src: string): string {
  if (!src) return '';
  let s = src;

  // 코드 펜스 ```lang ... ``` → 내용만 남김
  s = s.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, '$1');

  // 블록 레벨
  s = s.replace(/^#{1,6}\s+/gm, '');          // 헤더 #
  s = s.replace(/^\s{0,3}>\s?/gm, '');         // 인용 >
  s = s.replace(/^\s*[-*+]\s+/gm, '• ');       // 불릿 리스트
  s = s.replace(/^\s*(\d+)\.\s+/gm, '$1. ');   // 번호 리스트 간격 정리
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, ''); // 수평선 ---/***/___

  // 인라인
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');     // 볼드 **
  s = s.replace(/__([^_]+)__/g, '$1');          // 볼드 __
  s = s.replace(/\*([^*\n]+)\*/g, '$1');        // 이탤릭 *
  s = s.replace(/~~([^~]+)~~/g, '$1');          // 취소선
  s = s.replace(/`([^`]+)`/g, '$1');            // 인라인 코드
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // 링크 [텍스트](url) → 텍스트

  // 앱 커스텀 서식: {아래첨자} ^위첨자^ (renderInlineMarkdown 대응)
  s = s.replace(/\{([^{}]+)\}/g, '$1');
  s = s.replace(/\^([^^\n]+)\^/g, '$1');

  // 과도한 빈 줄 정리
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** 이미지 URL 목록을 공유 가능한 File[] 로 변환 (CORS/네트워크 실패 시 해당 항목 스킵) */
export async function urlsToShareFiles(urls: string[]): Promise<File[]> {
  const files: File[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) continue;
      const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
      const raw = (url.split('?')[0].split('/').pop() || 'image').replace(/[^\w.-]/g, '');
      const name = /\.\w+$/.test(raw) ? raw : `${raw || 'image'}.${ext}`;
      files.push(new File([blob], name, { type: blob.type }));
    } catch {
      // 공유 불가한 이미지는 조용히 건너뜀
    }
  }
  return files;
}
