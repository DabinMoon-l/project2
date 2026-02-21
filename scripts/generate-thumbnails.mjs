/**
 * 토끼 이미지 WebP 썸네일 생성 스크립트
 * 실행: node scripts/generate-thumbnails.mjs
 */
import sharp from 'sharp';
import { readdir, mkdir } from 'fs/promises';
import { join } from 'path';

const SRC_DIR = 'public/rabbit';
const OUT_DIR = 'public/rabbit_thumb';
const THUMB_WIDTH = 128;
const WEBP_QUALITY = 80;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SRC_DIR)).filter(f => f.endsWith('.png'));
  console.log(`${files.length}개 이미지 변환 시작...`);

  let done = 0;
  await Promise.all(
    files.map(async (file) => {
      const src = join(SRC_DIR, file);
      const out = join(OUT_DIR, file.replace('.png', '.webp'));
      await sharp(src)
        .resize(THUMB_WIDTH)
        .webp({ quality: WEBP_QUALITY })
        .toFile(out);
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${files.length} 완료`);
    })
  );

  console.log(`완료! ${OUT_DIR}에 ${files.length}개 WebP 썸네일 생성됨`);
}

main().catch(console.error);
