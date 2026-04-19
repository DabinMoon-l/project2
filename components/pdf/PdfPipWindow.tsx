'use client';

/**
 * PDF PiP 창 — 화면 위에 둥둥 떠 있는 독립 윈도우.
 *
 * 제스처:
 * - 탭(단일 pointer, 움직임 없음) → 오버레이 토글
 * - 좌우 스와이프(단일 pointer, 수평 > 50px) → 페이지 이동 (오버레이 무관)
 * - 두 손가락 핀치 → 크기 조절 (오버레이 무관)
 * - 오버레이 상태에서 상단 드래그바 포인터 → 창 이동
 * - 오버레이 상태 + PC → 4모서리 핸들 리사이즈 (터치는 핀치로 대체)
 *
 * 렌더링: pdfjs-dist 로 현재 페이지만 canvas에 그림. 페이지 변경 시 재그림.
 * 크기 변경 시: 창 크기에 맞춰 재렌더 (디바운스로 리사이즈 중 과다 렌더 방지).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPdfBlob, type PdfGeom, type PdfStroke } from '@/lib/repositories/indexedDb/pdfStore';
import { usePdfViewerStore } from '@/lib/stores/pdfViewerStore';
import { getPdfjs } from '@/lib/utils/pdfjs';

type PenColor = 'black' | 'red' | 'blue' | 'eraser';
const COLOR_HEX: Record<Exclude<PenColor, 'eraser'>, string> = {
  black: '#1A1A1A',
  red: '#E53935',
  blue: '#2962FF',
};
const SIZE_MIN = 1;
const SIZE_MAX = 14;
const SIZE_DEFAULT = 4;

/** stroke를 주어진 컨텍스트에 렌더. w/h는 현재 viewport 크기(논리 px) */
function drawStrokeOnCtx(
  ctx: CanvasRenderingContext2D,
  stroke: PdfStroke,
  w: number,
  h: number,
) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.color === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = COLOR_HEX[stroke.color as Exclude<PenColor, 'eraser'>] || '#1A1A1A';
  }
  // 저장 시의 크기는 viewport 기준이므로 현재 viewport에 맞게 선 굵기 스케일.
  // 단순화: 저장된 width를 그대로 사용 (캔버스 크기 비례로 이미 적절).
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  const [fx, fy] = stroke.points[0];
  ctx.moveTo(fx * w, fy * h);
  for (let i = 1; i < stroke.points.length; i++) {
    const [px, py] = stroke.points[i];
    ctx.lineTo(px * w, py * h);
  }
  ctx.stroke();
  ctx.restore();
}

interface Props {
  pdfId: string;
  pdfName: string;
  /** PDF 첫 페이지 aspect (w/h) — 창 크기 조절 시 비율 고정용. 검정 여백 방지 */
  aspect: number;
  geom: PdfGeom;
}

const MIN_W = 200;
const MIN_H = 200;
const MAX_W_RATIO = 0.95;
const MAX_H_RATIO = 0.95;
const TAP_THRESHOLD_PX = 8;
const SWIPE_THRESHOLD_PX = 50;

export default function PdfPipWindow({ pdfId, pdfName, aspect, geom }: Props) {
  const closePdf = usePdfViewerStore((s) => s.closePdf);
  const updateWindowGeom = usePdfViewerStore((s) => s.updateWindowGeom);
  const toggleBookmark = usePdfViewerStore((s) => s.toggleBookmark);
  const addStroke = usePdfViewerStore((s) => s.addStroke);
  const clearPageStrokes = usePdfViewerStore((s) => s.clearPageStrokes);
  // 이 PDF의 북마크/annotations를 store에서 직접 구독 (다른 창/사이드바와 동기화)
  const bookmarks = usePdfViewerStore(
    (s) => s.savedPdfs.find((p) => p.id === pdfId)?.bookmarks ?? [],
  );
  const annotations = usePdfViewerStore(
    (s) => s.savedPdfs.find((p) => p.id === pdfId)?.annotations ?? {},
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [overlayOn, setOverlayOn] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 필기 UI 상태
  const [palettesOpen, setPalettesOpen] = useState(false);
  const [activeColor, setActiveColor] = useState<PenColor | null>(null);
  const [activeSize, setActiveSize] = useState(SIZE_DEFAULT);
  const drawingActive = activeColor != null;

  // 스타일러스 더블탭 감지용 — 마지막 pen pointerup 시각
  const lastPenTapRef = useRef(0);
  // 현재 그리는 중인 stroke 포인트 (정규화 0~1)
  const currentStrokeRef = useRef<Array<[number, number]> | null>(null);

  // 최신 geom을 제스처 핸들러에서 읽기 위해 ref로 미러
  const geomRef = useRef(geom);
  geomRef.current = geom;

  // ── PDF 로드 ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const blob = await getPdfBlob(pdfId);
        if (!blob) throw new Error('파일을 찾을 수 없음');
        const buffer = await blob.arrayBuffer();
        const pdfjs = await getPdfjs();
        const doc = await pdfjs.getDocument({ data: buffer }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setPageCount(doc.numPages);
        setCurrentPage(1);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [pdfId]);

  // ── 페이지 렌더 (현재 페이지 + 창 크기 기준) ───────────────
  const renderPage = useCallback(async () => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;

    try {
      // 이전 렌더 취소
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await doc.getPage(currentPage);
      const viewport1 = page.getViewport({ scale: 1 });
      // 창 내부 크기에 맞춰 스케일
      const targetW = geomRef.current.w;
      const targetH = geomRef.current.h;
      const scaleX = targetW / viewport1.width;
      const scaleY = targetH / viewport1.height;
      const scale = Math.min(scaleX, scaleY); // 원본 비율 유지

      const viewport = page.getViewport({ scale });
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;

      // 저장된 stroke를 오버레이 캔버스에 렌더 (PDF 캔버스와 같은 치수로 크기 맞춤)
      const drawCanvas = drawCanvasRef.current;
      if (drawCanvas) {
        drawCanvas.width = canvas.width;
        drawCanvas.height = canvas.height;
        drawCanvas.style.width = canvas.style.width;
        drawCanvas.style.height = canvas.style.height;
        const dctx = drawCanvas.getContext('2d');
        if (dctx) {
          dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
          const strokes = (annotations[String(currentPage)] ?? []) as PdfStroke[];
          const w = viewport.width;
          const h = viewport.height;
          for (const stroke of strokes) {
            drawStrokeOnCtx(dctx, stroke, w, h);
          }
        }
      }
    } catch (err) {
      // cancel 에러는 정상
      const name = (err as { name?: string })?.name;
      if (name !== 'RenderingCancelledException') {
        console.error('[PdfPipWindow] render 실패:', err);
      }
    }
  }, [currentPage, annotations]);

  // 페이지 또는 창 크기 변경 시 재렌더 (크기 변경은 디바운스) + annotations 업데이트도 재렌더
  useEffect(() => {
    if (isLoading || !pdfDocRef.current) return;
    const t = setTimeout(() => renderPage(), 80);
    return () => clearTimeout(t);
  }, [renderPage, isLoading, geom.w, geom.h]);

  // 페이지 변경 핸들러
  const nextPage = useCallback(() => {
    setCurrentPage((p) => Math.min(p + 1, pageCount));
  }, [pageCount]);
  const prevPage = useCallback(() => {
    setCurrentPage((p) => Math.max(p - 1, 1));
  }, []);

  // 키보드 ←→
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevPage();
      else if (e.key === 'ArrowRight') nextPage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextPage, prevPage]);

  // ── 제스처 (pointer events) ────────────────────────────────
  // 포인터 추적: 동시 여러 개(핀치)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  // 첫 포인터의 다운 지점 (탭/스와이프 판정용)
  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // 핀치 시작 거리/크기
  const pinchStartRef = useRef<{ dist: number; w: number; h: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (pointersRef.current.size === 1) {
      tapStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      pinchStartRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStartRef.current = {
        dist: Math.hypot(dx, dy),
        w: geomRef.current.w,
        h: geomRef.current.h,
      };
      // 핀치 시작 시 탭 판정 무효화
      tapStartRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      if (pinchStartRef.current.dist <= 0) return;
      const scale = dist / pinchStartRef.current.dist;
      // PDF aspect(w/h) 고정 — 두 손가락 거리만 크기 스케일에 사용, 항상 비율 유지
      let newW = Math.max(
        MIN_W,
        Math.min(window.innerWidth * MAX_W_RATIO, pinchStartRef.current.w * scale),
      );
      let newH = newW / aspect;
      // 세로 초과 시 거꾸로 보정
      if (newH > window.innerHeight * MAX_H_RATIO) {
        newH = window.innerHeight * MAX_H_RATIO;
        newW = newH * aspect;
      }
      if (newH < MIN_H) {
        newH = MIN_H;
        newW = newH * aspect;
      }
      updateWindowGeom(pdfId, { w: newW, h: newH });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const start = tapStartRef.current;
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 0 && pinchStartRef.current) {
      pinchStartRef.current = null;
      return;
    }

    // 포인터 하나 남음(=핀치에서 하나 떼기) 재시작
    if (pointersRef.current.size >= 1 && pinchStartRef.current) {
      pinchStartRef.current = null;
      tapStartRef.current = null;
      return;
    }

    // 단일 포인터 종료: 탭 or 스와이프 판정
    if (start && pointersRef.current.size === 0) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < TAP_THRESHOLD_PX && absDy < TAP_THRESHOLD_PX) {
        // 탭 → 오버레이 토글
        setOverlayOn((v) => !v);
      } else if (absDx > SWIPE_THRESHOLD_PX && absDx > absDy) {
        // 좌우 스와이프 → 페이지 이동
        if (dx < 0) nextPage();
        else prevPage();
      }
    }
    tapStartRef.current = null;
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      tapStartRef.current = null;
      pinchStartRef.current = null;
    }
  };

  // ── 오버레이 전용 제스처: 드래그바 이동 + 모서리 리사이즈 ──
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{
    corner: 'tl' | 'tr' | 'bl' | 'br';
    startX: number;
    startY: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const handleMoveBarDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      x: geomRef.current.x,
      y: geomRef.current.y,
    };
    window.addEventListener('pointermove', onWindowDragMove);
    window.addEventListener('pointerup', onWindowDragUp);
  };
  const onWindowDragMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Math.max(0, Math.min(window.innerWidth - geomRef.current.w, d.x + (e.clientX - d.startX)));
    const ny = Math.max(0, Math.min(window.innerHeight - geomRef.current.h, d.y + (e.clientY - d.startY)));
    updateWindowGeom(pdfId, { x: nx, y: ny });
  };
  const onWindowDragUp = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onWindowDragMove);
    window.removeEventListener('pointerup', onWindowDragUp);
  };

  const handleResizeDown = (corner: 'tl' | 'tr' | 'bl' | 'br') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    resizeRef.current = {
      corner,
      startX: e.clientX,
      startY: e.clientY,
      x: geomRef.current.x,
      y: geomRef.current.y,
      w: geomRef.current.w,
      h: geomRef.current.h,
    };
    window.addEventListener('pointermove', onWindowResizeMove);
    window.addEventListener('pointerup', onWindowResizeUp);
  };
  const onWindowResizeMove = (e: PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;
    // aspect lock — 대각선 거리로 스케일 결정 후 h = w / aspect
    // 각 코너별 w의 증감 방향을 부호로 반영
    const signW = r.corner === 'tr' || r.corner === 'br' ? 1 : -1;
    const signH = r.corner === 'bl' || r.corner === 'br' ? 1 : -1;
    // 사용자가 더 크게 움직인 축을 주 드라이버로 채택
    const wCand = Math.max(MIN_W, r.w + signW * dx);
    const hCand = Math.max(MIN_H, r.h + signH * dy);
    // 둘 중 실제 비율에 맞게 조정 — w 기준 우선
    let w = wCand;
    let h = w / aspect;
    if (Math.abs(h - r.h) < Math.abs(hCand - r.h)) {
      // h 기준 움직임이 더 큼 → h 기준으로 w 재계산
      h = hCand;
      w = h * aspect;
    }
    let x = r.x;
    let y = r.y;
    // 좌측 코너면 x 보정, 상단 코너면 y 보정 (대각선 반대 지점 고정)
    if (r.corner === 'bl' || r.corner === 'tl') x = r.x + (r.w - w);
    if (r.corner === 'tr' || r.corner === 'tl') y = r.y + (r.h - h);
    // 화면 경계 제한
    w = Math.min(w, window.innerWidth * MAX_W_RATIO);
    h = Math.min(h, window.innerHeight * MAX_H_RATIO);
    updateWindowGeom(pdfId, { x, y, w, h });
  };
  const onWindowResizeUp = () => {
    resizeRef.current = null;
    window.removeEventListener('pointermove', onWindowResizeMove);
    window.removeEventListener('pointerup', onWindowResizeUp);
  };

  // 언마운트 정리
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onWindowDragMove);
      window.removeEventListener('pointerup', onWindowDragUp);
      window.removeEventListener('pointermove', onWindowResizeMove);
      window.removeEventListener('pointerup', onWindowResizeUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 필기 캔버스 포인터 핸들러 ──────────────────────────────
  const getNormalizedPoint = useCallback((e: React.PointerEvent): [number, number] | null => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    return [nx, ny];
  }, []);

  const handleDrawPointerDown = (e: React.PointerEvent) => {
    // 스타일러스 더블탭(300ms 내) → 펜/지우개 토글
    if (e.pointerType === 'pen') {
      const now = Date.now();
      if (now - lastPenTapRef.current < 350) {
        setActiveColor((c) => (c === 'eraser' ? 'black' : 'eraser'));
        lastPenTapRef.current = 0;
        return;
      }
      lastPenTapRef.current = now;
    }
    if (!drawingActive) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = getNormalizedPoint(e);
    if (!p) return;
    currentStrokeRef.current = [p];

    // 라이브 스트로크 시작 — drawing 캔버스에 직접 그림 (저장은 up 시)
    const canvas = drawCanvasRef.current;
    const dctx = canvas?.getContext('2d');
    if (!canvas || !dctx) return;
    const rect = canvas.getBoundingClientRect();
    dctx.save();
    dctx.lineCap = 'round';
    dctx.lineJoin = 'round';
    dctx.lineWidth = activeSize;
    if (activeColor === 'eraser') {
      dctx.globalCompositeOperation = 'destination-out';
      dctx.strokeStyle = 'rgba(0,0,0,1)';
    } else if (activeColor) {
      dctx.globalCompositeOperation = 'source-over';
      dctx.strokeStyle = COLOR_HEX[activeColor];
    }
    dctx.beginPath();
    dctx.moveTo(p[0] * rect.width, p[1] * rect.height);
    // 상태 저장 (ctx는 restore 안 함 — move/up에서 계속 사용)
  };

  const handleDrawPointerMove = (e: React.PointerEvent) => {
    if (!drawingActive || !currentStrokeRef.current) return;
    e.stopPropagation();
    const p = getNormalizedPoint(e);
    if (!p) return;
    currentStrokeRef.current.push(p);
    const canvas = drawCanvasRef.current;
    const dctx = canvas?.getContext('2d');
    if (!canvas || !dctx) return;
    const rect = canvas.getBoundingClientRect();
    dctx.lineTo(p[0] * rect.width, p[1] * rect.height);
    dctx.stroke();
    // 이어서 그리기 위해 다시 moveTo — beginPath 없이 lineTo+stroke
    dctx.beginPath();
    dctx.moveTo(p[0] * rect.width, p[1] * rect.height);
  };

  const handleDrawPointerUp = (e: React.PointerEvent) => {
    if (!drawingActive) return;
    const pts = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (!pts || pts.length === 0) return;
    const canvas = drawCanvasRef.current;
    const dctx = canvas?.getContext('2d');
    dctx?.restore();
    if (!activeColor) return;
    const stroke: PdfStroke = {
      color: activeColor,
      width: activeSize,
      points: pts,
    };
    addStroke(pdfId, currentPage, stroke);
    e.stopPropagation();
  };

  return (
    <div
      ref={rootRef}
      className="fixed bg-[#1A1A1A] shadow-2xl select-none touch-none"
      style={{
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.h,
        zIndex: 200,
        borderRadius: 8,
        // 필기 팔레트가 PiP 바깥으로 튀어나와야 해서 overflow visible
        overflow: 'visible',
      }}
      onPointerDown={drawingActive ? undefined : handlePointerDown}
      onPointerMove={drawingActive ? undefined : handlePointerMove}
      onPointerUp={drawingActive ? undefined : handlePointerUp}
      onPointerCancel={drawingActive ? undefined : handlePointerCancel}
    >
      {/* PDF 캔버스 + 필기 캔버스 — 겹쳐 배치. 창 모서리 둥글리기용 내부 래퍼 */}
      <div
        className="relative w-full h-full flex items-center justify-center bg-[#1A1A1A]"
        style={{ borderRadius: 8, overflow: 'hidden' }}
      >
        {isLoading && (
          <div className="text-white/60 text-xs">로딩…</div>
        )}
        {loadError && (
          <div className="text-red-400 text-xs px-4 text-center">{loadError}</div>
        )}
        {!isLoading && !loadError && (
          <>
            <canvas ref={canvasRef} />
            {/* 필기 오버레이 캔버스 — 드로잉 모드일 때만 pointer events 받음 */}
            <canvas
              ref={drawCanvasRef}
              className="absolute"
              style={{
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: drawingActive ? 'auto' : 'none',
                touchAction: 'none',
              }}
              onPointerDown={handleDrawPointerDown}
              onPointerMove={handleDrawPointerMove}
              onPointerUp={handleDrawPointerUp}
              onPointerCancel={handleDrawPointerUp}
            />
          </>
        )}
      </div>

      {/* 오버레이 — 탭 토글, 재탭까지 유지.
          독립 뉴스 캐러셀 헤더 스타일(검정+세리프+대시) + 창 이동 드래그 영역 겸용.
          상단 헤더 + 좌상단 북마크 토글 + 하단 페이지 슬라이더(북마크 표식) + 모서리 리사이즈.
          페이지 이동: 스와이프/키보드/슬라이더. 창 닫기: 사이드바 ✕. */}
      {overlayOn && !isLoading && !loadError && (
        <>
          {/* 뉴스 헤더 = 파일명 + 드래그 영역 */}
          <div
            onPointerDown={handleMoveBarDown}
            className="absolute top-0 left-0 right-0 bg-[#1A1A1A] text-[#F5F0E8] px-3 py-1.5 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
            style={{ touchAction: 'none' }}
          >
            <div className="text-center w-full">
              <p className="text-[6px] tracking-[0.2em] mb-0.5 opacity-60">━━━━━━━━━━━━━━━━</p>
              <h1 className="font-serif text-base font-black tracking-tight truncate">{pdfName}</h1>
            </div>
          </div>

          {/* 좌상단 북마크 토글 — 테두리(비활성)/빨강 채움(활성) */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleBookmark(pdfId, currentPage);
            }}
            className="absolute top-1 left-1 w-7 h-7 flex items-center justify-center z-10"
            aria-label={bookmarks.includes(currentPage) ? '북마크 해제' : '북마크 추가'}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))' }}>
              {bookmarks.includes(currentPage) ? (
                // 채워진 빨간 북마크
                <path d="M6 3h12v18l-6-4.5L6 21V3z" fill="#E53935" stroke="#F5F0E8" strokeWidth={1} />
              ) : (
                // 테두리만
                <path d="M6 3h12v18l-6-4.5L6 21V3z" fill="none" stroke="#F5F0E8" strokeWidth={1.8} />
              )}
            </svg>
          </button>

          {/* 우상단: 연필(좌) + 닫기 X(우) */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              closePdf(pdfId);
            }}
            className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center z-10"
            aria-label="닫기"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))' }}>
              <path d="M6 6l12 12M18 6L6 18" stroke="#F5F0E8" strokeWidth={2} strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (palettesOpen) {
                setPalettesOpen(false);
                setActiveColor(null);
              } else {
                setPalettesOpen(true);
                setActiveColor((c) => c ?? 'black');
              }
            }}
            className="absolute top-1 right-9 w-7 h-7 flex items-center justify-center z-10"
            aria-label={palettesOpen ? '필기 종료' : '필기'}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))' }}>
              {palettesOpen ? (
                <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zM20.7 7.03a1 1 0 000-1.41l-2.32-2.32a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.81-1.85z" fill="#E53935" stroke="#F5F0E8" strokeWidth={0.8} />
              ) : (
                <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11zM20.7 7.03a1 1 0 000-1.41l-2.32-2.32a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.81-1.85z" fill="none" stroke="#F5F0E8" strokeWidth={1.8} />
              )}
            </svg>
          </button>

          {/* 1차 팔레트: 4색 — PiP 바깥 우상단 호를 따라 배치 */}
          {palettesOpen && (
            <div
              className="absolute"
              style={{ top: 0, right: 0, width: 0, height: 0, zIndex: 20 }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {(['black', 'red', 'blue', 'eraser'] as PenColor[]).map((c, i) => {
                const angle = -(i * 22 + 10) * (Math.PI / 180); // 위쪽으로 호 그리기 (위 = -90°)
                const r = 58;
                const cx = Math.cos(angle) * r;
                const cy = Math.sin(angle) * r;
                const isActive = activeColor === c;
                const bg = c === 'black' ? '#1A1A1A' : c === 'red' ? '#E53935' : c === 'blue' ? '#2962FF' : 'transparent';
                const isEraser = c === 'eraser';
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setActiveColor(c)}
                    className={`absolute rounded-full flex items-center justify-center transition-transform ${
                      isActive ? 'ring-2 ring-white scale-110' : 'ring-1 ring-white/60'
                    }`}
                    style={{
                      left: cx - 14,
                      top: cy - 14,
                      width: 28,
                      height: 28,
                      backgroundColor: bg,
                      backgroundImage: isEraser
                        ? 'repeating-linear-gradient(45deg, #aaa 0 4px, #eee 4px 8px)'
                        : undefined,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                    }}
                    aria-label={c}
                  >
                    {isEraser && <span className="text-[10px] font-bold text-[#333]">E</span>}
                  </button>
                );
              })}

              {/* 2차 팔레트: 크기 슬라이더 — 색 선택됐을 때만. 1차보다 더 바깥 호 */}
              {activeColor && (
                <div
                  className="absolute"
                  style={{
                    // 1차 중앙(~angle -55°)에서 더 바깥으로
                    left: Math.cos(-(55 * Math.PI) / 180) * 112 - 70,
                    top: Math.sin(-(55 * Math.PI) / 180) * 112 - 18,
                    width: 140,
                    height: 36,
                    transform: 'rotate(-55deg)',
                    transformOrigin: 'center',
                  }}
                >
                  <div className="flex items-center gap-1.5 bg-black/80 backdrop-blur px-2 py-1.5 rounded-full shadow-lg">
                    <input
                      type="range"
                      min={SIZE_MIN}
                      max={SIZE_MAX}
                      value={activeSize}
                      onChange={(e) => setActiveSize(Number(e.target.value))}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="flex-1 h-1 appearance-none bg-white/30 rounded-full cursor-pointer"
                      style={{ accentColor: '#F5F0E8' }}
                    />
                    {activeColor === 'eraser' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('현재 페이지의 필기를 모두 지울까요?')) {
                            clearPageStrokes(pdfId, currentPage);
                          }
                        }}
                        className="text-[10px] font-bold text-white px-1.5 py-0.5 bg-[#E53935] rounded"
                      >
                        ALL
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 하단 페이지 슬라이더 — 북마크 표식 포함 */}
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-[#1A1A1A]/80 backdrop-blur-sm"
          >
            <div className="relative h-5 flex items-center">
              {/* 슬라이더 */}
              <input
                type="range"
                min={1}
                max={pageCount}
                value={currentPage}
                onChange={(e) => setCurrentPage(Number(e.target.value))}
                className="w-full h-1 rounded-full appearance-none bg-white/20 cursor-pointer"
                style={{
                  accentColor: '#F5F0E8',
                }}
              />
              {/* 북마크 마커 — 트랙 위에 빨간 점 */}
              {pageCount > 1 && bookmarks.map((bp) => {
                const pct = ((bp - 1) / (pageCount - 1)) * 100;
                return (
                  <div
                    key={bp}
                    className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{
                      left: `calc(${pct}% )`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <div className="w-1.5 h-3 bg-[#E53935] rounded-sm shadow" />
                  </div>
                );
              })}
            </div>
            {/* 현재/총 페이지 */}
            <div className="mt-0.5 text-center text-[10px] text-white/70 font-mono">
              {currentPage} / {pageCount}
            </div>
          </div>

          {/* 4 모서리 리사이즈 핸들 (PC — 터치는 핀치로 충분, aspect 고정) */}
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <div
              key={c}
              onPointerDown={handleResizeDown(c)}
              className={`absolute w-4 h-4 ${
                c === 'tl' ? 'top-0 left-0 cursor-nwse-resize' :
                c === 'tr' ? 'top-0 right-0 cursor-nesw-resize' :
                c === 'bl' ? 'bottom-0 left-0 cursor-nesw-resize' :
                            'bottom-0 right-0 cursor-nwse-resize'
              }`}
              style={{ touchAction: 'none' }}
            />
          ))}
        </>
      )}
    </div>
  );
}
