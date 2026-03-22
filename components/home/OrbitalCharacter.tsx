import { motion, useTransform, type MotionValue } from 'framer-motion';
import { ORBIT_RX as DEFAULT_RX, ORBIT_RY as DEFAULT_RY, CHAR_SIZE as DEFAULT_SIZE } from './characterBoxConstants';
import { FloatingWrapper } from './FloatingWrapper';

/** 궤도 위 캐릭터 — useTransform으로 타원 경로 공전 */
export function OrbitalCharacter({
  rabbitId,
  springRotation,
  charIndex,
  isPressing = false,
  orbitRx = DEFAULT_RX,
  orbitRy = DEFAULT_RY,
  charSize = DEFAULT_SIZE,
}: {
  rabbitId: number;
  springRotation: MotionValue<number>;
  charIndex: number;
  isPressing?: boolean;
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
    return 0.4 + 0.6 * depth;
  });

  return (
    <motion.div
      className="absolute"
      style={{ left: 0, top: 0, x, y, scale, zIndex, opacity }}
    >
      <FloatingWrapper seed={charIndex}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <motion.img
          src={`/rabbit/rabbit-${String(rabbitId + 1).padStart(3, '0')}.png`}
          alt=""
          width={charSize}
          height={Math.round(charSize * (969 / 520))}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          animate={{ scale: isPressing ? 0.9 : 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          style={{
            filter: 'sepia(0.08) saturate(1.1) brightness(1.03) hue-rotate(-5deg)',
            WebkitTouchCallout: 'none',
            userSelect: 'none',
          }}
        />
      </FloatingWrapper>
    </motion.div>
  );
}
