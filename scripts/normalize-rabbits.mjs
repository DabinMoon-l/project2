/**
 * 토끼 이미지 정규화 스크립트
 *
 * 모든 80개 토끼 이미지를 동일한 캔버스(520×969)에 맞추고,
 * 캐릭터 크기를 토끼 #40 기준으로 통일합니다.
 *
 * 사용법: node scripts/normalize-rabbits.mjs
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RABBIT_DIR = path.join(ROOT, 'public', 'rabbit');
const THUMB_DIR = path.join(ROOT, 'public', 'rabbit_thumb');
const BACKUP_DIR = path.join(ROOT, 'public', 'rabbit_backup');

const TOTAL = 80;
const REFERENCE_ID = 40; // 1-indexed (rabbit-040.png)

// 표준 캔버스 — RabbitImage 컴포넌트의 하드코딩된 비율과 동일
const CANVAS_W = 520;
const CANVAS_H = 969;

// 썸네일 설정
const THUMB_WIDTH = 128;
const THUMB_QUALITY = 80;

/**
 * 이미지의 콘텐츠 바운딩 박스를 가져옴 (투명 영역 제외)
 */
async function getContentBounds(filePath) {
  const image = sharp(filePath);
  const metadata = await image.metadata();

  // trim()으로 투명 영역 제거 → 실제 콘텐츠 크기 파악
  const { data, info } = await image
    .trim({ threshold: 10 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    contentWidth: info.width,
    contentHeight: info.height,
    trimOffsetLeft: info.trimOffsetLeft || 0,
    trimOffsetTop: info.trimOffsetTop || 0,
  };
}

async function main() {
  // 백업 디렉토리 생성
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`백업 디렉토리 생성: ${BACKUP_DIR}`);
  }

  // 썸네일 디렉토리 확인
  if (!fs.existsSync(THUMB_DIR)) {
    fs.mkdirSync(THUMB_DIR, { recursive: true });
  }

  // Step 1: 모든 토끼 분석
  console.log('=== Step 1: 이미지 분석 ===\n');
  const analyses = [];

  for (let i = 1; i <= TOTAL; i++) {
    const padded = String(i).padStart(3, '0');
    const filePath = path.join(RABBIT_DIR, `rabbit-${padded}.png`);

    if (!fs.existsSync(filePath)) {
      console.log(`  #${i}: 파일 없음, 건너뜀`);
      analyses.push(null);
      continue;
    }

    // 백업
    const backupPath = path.join(BACKUP_DIR, `rabbit-${padded}.png`);
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
    }

    const bounds = await getContentBounds(filePath);
    analyses.push(bounds);
    console.log(
      `  #${i}: 캔버스=${bounds.originalWidth}×${bounds.originalHeight}` +
      ` 콘텐츠=${bounds.contentWidth}×${bounds.contentHeight}` +
      ` 비율=${(bounds.contentHeight / bounds.originalHeight).toFixed(3)}`
    );
  }

  // Step 2: 기준 토끼 (#40) 분석
  const ref = analyses[REFERENCE_ID - 1];
  if (!ref) {
    throw new Error(`기준 토끼 #${REFERENCE_ID} 분석 실패`);
  }

  // #40의 콘텐츠가 캔버스에서 차지하는 비율
  const refHeightRatio = ref.contentHeight / ref.originalHeight; // ~0.956
  const refWidthRatio = ref.contentWidth / ref.originalWidth;    // ~0.905

  // 표준 캔버스에서의 타겟 콘텐츠 크기
  const targetContentH = Math.round(refHeightRatio * CANVAS_H);
  const targetContentW = Math.round(refWidthRatio * CANVAS_W);

  console.log(`\n=== Step 2: 기준 설정 ===`);
  console.log(`  기준 토끼: #${REFERENCE_ID}`);
  console.log(`  기준 높이 비율: ${refHeightRatio.toFixed(3)}`);
  console.log(`  기준 너비 비율: ${refWidthRatio.toFixed(3)}`);
  console.log(`  표준 캔버스: ${CANVAS_W}×${CANVAS_H}`);
  console.log(`  타겟 콘텐츠: ${targetContentW}×${targetContentH}`);

  // Step 3: 정규화
  console.log(`\n=== Step 3: 정규화 ===\n`);
  let processed = 0;

  for (let i = 1; i <= TOTAL; i++) {
    const a = analyses[i - 1];
    if (!a) continue;

    const padded = String(i).padStart(3, '0');
    const filePath = path.join(RABBIT_DIR, `rabbit-${padded}.png`);
    const thumbPath = path.join(THUMB_DIR, `rabbit-${padded}.webp`);

    // 콘텐츠를 타겟 크기에 맞게 스케일링 (fit: inside)
    // 높이 우선으로 맞추되, 너비가 캔버스를 넘으면 너비에 맞춤
    const maxW = CANVAS_W - 20; // 좌우 10px 여백
    const maxH = targetContentH;

    const scaleByH = maxH / a.contentHeight;
    const scaleByW = maxW / a.contentWidth;
    const scale = Math.min(scaleByH, scaleByW);

    const newContentW = Math.round(a.contentWidth * scale);
    const newContentH = Math.round(a.contentHeight * scale);

    // 콘텐츠를 리사이즈
    const resizedContent = await sharp(a.buffer)
      .resize(newContentW, newContentH, {
        fit: 'fill', // 정확한 크기로 (이미 비율 계산함)
        kernel: 'lanczos3',
      })
      .toBuffer();

    // 캔버스 중앙에 배치 (하단 정렬: 토끼가 바닥에 서 있도록)
    const left = Math.round((CANVAS_W - newContentW) / 2);
    // 하단 정렬: 바닥에서 약간 위로 (캔버스 높이의 2% 여백)
    const bottomMargin = Math.round(CANVAS_H * 0.02);
    const top = CANVAS_H - newContentH - bottomMargin;

    // 표준 캔버스에 합성
    await sharp({
      create: {
        width: CANVAS_W,
        height: CANVAS_H,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{
        input: resizedContent,
        left: Math.max(0, left),
        top: Math.max(0, top),
      }])
      .png()
      .toFile(filePath);

    // 썸네일 생성
    const thumbH = Math.round(THUMB_WIDTH * (CANVAS_H / CANVAS_W));
    await sharp(filePath)
      .resize(THUMB_WIDTH, thumbH, { fit: 'fill' })
      .webp({ quality: THUMB_QUALITY })
      .toFile(thumbPath);

    const scalePercent = (scale * 100).toFixed(1);
    console.log(
      `  #${i}: ${a.contentWidth}×${a.contentHeight} → ${newContentW}×${newContentH}` +
      ` (×${scalePercent}%) → ${CANVAS_W}×${CANVAS_H} 캔버스`
    );
    processed++;
  }

  console.log(`\n=== 완료 ===`);
  console.log(`  처리: ${processed}개`);
  console.log(`  캔버스: ${CANVAS_W}×${CANVAS_H}`);
  console.log(`  썸네일: ${THUMB_WIDTH}px WebP`);
  console.log(`  백업: ${BACKUP_DIR}`);
}

main().catch(console.error);
