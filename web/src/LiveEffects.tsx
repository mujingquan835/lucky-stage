import { useEffect, useState } from "react";
import "./live-support.css";
export function Confetti({ trigger }: { trigger: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!trigger || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [trigger]);
  return visible ? (
    <div className="live-confetti" aria-hidden="true">
      {Array.from({ length: 32 }, (_, i) => (
        <i
          key={i}
          style={{
            left: (i % 2 ? 94 + (i % 5) : i % 6) + "%",
            background: ["#ff7538", "#ffd76a", "#68baff", "#b089e0"][i % 4],
            animationDelay: (i % 8) * 0.06 + "s",
            transform: `rotate(${i * 23}deg)`,
          }}
        />
      ))}
    </div>
  ) : null;
}
