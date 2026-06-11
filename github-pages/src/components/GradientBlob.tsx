interface GradientBlobProps {
  /** Two of the decorative colors: #e55cff, #8247f5, #ffa600, #0099ff */
  colors: [string, string];
  /** Position/size the blob from the caller, e.g. "inset-[-10%]" */
  className?: string;
}

/**
 * Soft-edged organic gradient backdrop, layered behind product UI cards.
 * Pure CSS — radial gradients at ~35-45% opacity with heavy blur (capped
 * on mobile, where large blur radii get expensive).
 */
export default function GradientBlob({ colors: [first, second], className = '' }: GradientBlobProps) {
  return (
    <div aria-hidden className={`pointer-events-none absolute ${className}`}>
      <div
        className="absolute inset-0 -rotate-12 blur-[80px] max-md:blur-[40px]"
        style={{
          background: `radial-gradient(closest-side, ${first}66, transparent)`,
          borderRadius: '58% 42% 38% 62% / 42% 55% 45% 58%',
        }}
      />
      <div
        className="absolute inset-[10%] translate-x-[16%] translate-y-[12%] rotate-[18deg] blur-[70px] max-md:blur-[40px]"
        style={{
          background: `radial-gradient(closest-side, ${second}73, transparent)`,
          borderRadius: '42% 58% 62% 38% / 55% 42% 58% 45%',
        }}
      />
    </div>
  );
}
