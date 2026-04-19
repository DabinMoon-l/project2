/**
 * pdfjs-dist 동적 로드 싱글턴.
 *
 * 기존엔 각 파일(OCR, AI 퀴즈 모달, 문제 생성 페이지, PDF 뷰어 등)이
 * 동일한 getPdfjs() 보일러플레이트를 복제하고 있었음. workerSrc URL/버전을
 * 바꿀 일이 생기면 7곳을 모두 수정해야 했음 → 1곳으로 일원화.
 *
 * 번들 크기: pdfjs 본체는 첫 호출 시에만 import되어 초기 번들에 포함되지 않음.
 */

let _pdfjsLib: typeof import('pdfjs-dist') | null = null;

/** PWA 오프라인 대응용 로컬 worker (public/pdf.worker.min.mjs). CDN보다 안정적. */
const WORKER_SRC = '/pdf.worker.min.mjs';

export async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!_pdfjsLib) {
    const mod = await import('pdfjs-dist');
    mod.GlobalWorkerOptions.workerSrc = WORKER_SRC;
    _pdfjsLib = mod;
  }
  return _pdfjsLib;
}
