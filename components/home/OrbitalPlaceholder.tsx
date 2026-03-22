import { motion, useTransform, type MotionValue } from 'framer-motion';
import { ORBIT_RX as DEFAULT_RX, ORBIT_RY as DEFAULT_RY, CHAR_SIZE as DEFAULT_SIZE } from './characterBoxConstants';
import { FloatingWrapper } from './FloatingWrapper';

/** 궤도 위 빈 슬롯 플레이스홀더 — 흰색 "?" 표시 */
export function OrbitalPlaceholder({
  springRotation,
  charIndex,
  orbitRx = DEFAULT_RX,
  orbitRy = DEFAULT_RY,
  charSize = DEFAULT_SIZE,
}: {
  springRotation: MotionValue<number>;
  charIndex: number;
  orbitRx?: number;
  orbitRy?: number;
  charSize?: number;
}) {
  const offset = charIndex * Math.PI;

  const x = useTransform(springRotation, r =>
    orbitRx * (1 + Math.cos(r + offset))
  );
  const y = useTransform(springRotation, r =>
    orbitRy * (1 + Math.sin(r + offset))
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
          style={{ width: charSize, height: charSize, paddingTop: charSize * 0.55 }}
        >
          <span className="text-white font-black" style={{ fontSize: charSize * 0.7, lineHeight: 1, textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            ?
          </span>
        </div>
      </FloatingWrapper>
    </motion.div>
  );
}
