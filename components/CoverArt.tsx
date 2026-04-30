/** Hash a string into a hue in [0, 360). */
export function titleHue(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

interface Props {
  title: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function CoverArt({ title, size = "md", className = "" }: Props) {
  const hue = titleHue(title);
  const initial = (title.trim()[0] ?? "?").toUpperCase();
  const sizes = {
    sm: { box: "h-16 w-16", font: "text-xl" },
    md: { box: "h-24 w-24 sm:h-28 sm:w-28", font: "text-3xl" },
    lg: { box: "h-32 w-32", font: "text-4xl" }
  } as const;
  const s = sizes[size];
  return (
    <div
      className={`${s.box} shrink-0 rounded-xl grid place-items-center font-black shadow-card ${s.font} ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 35%) 0%, hsl(${(hue + 50) % 360} 80% 18%) 100%)`,
        color: "rgba(255,255,255,0.92)"
      }}
      aria-hidden
    >
      {initial}
    </div>
  );
}
