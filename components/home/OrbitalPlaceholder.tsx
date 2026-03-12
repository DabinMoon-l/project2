import { motion, useTransform, type MotionValue } from 'framer-motion';
import { ORBIT_RX, ORBIT_RY, CHAR_SIZE } from './characterBoxConstants';
import { FloatingWrapper } from './FloatingWrapper';

/** 궤도 위 빈 슬롯 플레이스홀더 — 흰색 "?" 표시 */
export function OrbitalPlaceholder({
  springRotation,
  charIndex,
}: {
  springRotation: MotionValue<number>;
  charIndex: number;
}) {
  const offset = charIndex * Math.PI;

  const x = useTransform(springRotation, r =>
    ORBIT_RX * (1 + Math.cos(r + offset))
  );
  const y = useTransform(springRotation, r =>
    ORBIT_RY * (1 + Math.sin(r + offset))
  );
  const scale = useTransform(springRotation, r => {
    const depth = (Math.sin(r + offset) + 1) / 2;
    return 0.5 + 0.5 * depth;
  });
  const zIndex = useTransform(springRotation, r =>
    Math.sin(r + offset) > -0.1 ? 10 : 1
  );
  const opacity = useTransform(springRotation, r => {
    const depth = (Math.sin(r + offset) + 1) / 2;
    return 0.3 + 0.5 * depth;
  });

  return (
    <motion.div
      className="absolute"
      style={{ left: 0, top: 0, x, y, scale, zIndex, opacity }}
    >
      <FloatingWrapper seed={charIndex}>
        <div
          className="flex items-center justify-center drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          style={{ width: CHAR_SIZE, height: CHAR_SIZE, paddingTop: CHAR_SIZE * 0.55 }}
        >
          <span className="text-white font-black" style={{ fontSize: CHAR_SIZE * 0.7, lineHeight: 1, textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            ?
          </span>
        </div>
      </FloatingWrapper>
    </motion.div>
  );
}
