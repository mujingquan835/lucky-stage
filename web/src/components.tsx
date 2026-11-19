import type { ReactNode } from "react";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0112 0v3M16 5a3 3 0 010 6M18 15a5 5 0 013 4v2" />
      </>
    ),
    gift: (
      <>
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M5 12v9h14v-9M12 8v13M12 8H8a3 3 0 113-3l1 3zm0 0h4a3 3 0 10-3-3l-1 3z" />
      </>
    ),
    play: (
      <>
        <path d="M9 5l11 7-11 7z" />
        <path d="M4 5v14" />
      </>
    ),
    list: (
      <>
        <path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z" />
      </>
    ),
    screen: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 22h8M12 17v5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M15 15l6 6" />
      </>
    ),
    arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
    check: <path d="M5 12l4 4L19 6" />,
    close: <path d="M6 6l12 12M6 18L18 6" />,
    down: <path d="M6 9l6 6 6-6" />,
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3M7 8l5-5 5 5M4 16v5h16v-5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H4v16h6M10 12h11M16 7l5 5-5 5" />
      </>
    ),
    spark: (
      <>
        <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    edit: (
      <>
        <path d="M4 16l-1 5 5-1L21 7l-4-4zM14 6l4 4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6zM8 12l3 3 5-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.gift}
    </svg>
  );
}
export function GiftArt({
  index = 0,
  image = "",
  name = "礼品",
}: {
  index?: number;
  image?: string;
  name?: string;
}) {
  if (image) return <img className="gift-image" src={image} alt={name} />;
  return (
    <div className={"gift-art art-" + (index % 3)} aria-label="礼品示意图">
      <svg viewBox="0 0 200 180" fill="none" aria-hidden="true">
        <ellipse
          cx="100"
          cy="156"
          rx="59"
          ry="9"
          fill="currentColor"
          opacity=".08"
        />
        {index % 3 === 0 ? (
          <>
            <rect
              x="56"
              y="49"
              width="88"
              height="99"
              rx="13"
              fill="#e7c19a"
              stroke="#a77851"
              strokeWidth="2"
            />
            <path
              d="M83 49V31h34v18M76 68v62M100 68v62M124 68v62"
              stroke="#a77851"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <circle cx="73" cy="151" r="5" fill="#745740" />
            <circle cx="127" cy="151" r="5" fill="#745740" />
            <path d="M68 45h64" stroke="#f5ddc4" strokeWidth="4" />
          </>
        ) : index % 3 === 1 ? (
          <>
            <rect
              x="54"
              y="39"
              width="92"
              height="106"
              rx="9"
              fill="#efe7dc"
              stroke="#8d857c"
              strokeWidth="2"
            />
            <rect x="66" y="50" width="68" height="26" rx="4" fill="#3f4946" />
            <circle cx="120" cy="63" r="4" fill="#d3ad76" />
            <path
              d="M86 92h28v26H86z"
              fill="#faf7f1"
              stroke="#9e8d77"
              strokeWidth="2"
            />
            <path
              d="M114 97h6a8 8 0 010 16h-6"
              stroke="#9e8d77"
              strokeWidth="3"
            />
            <path
              d="M75 129h50"
              stroke="#8d857c"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <rect
              x="72"
              y="42"
              width="57"
              height="107"
              rx="17"
              fill="#a0b7a4"
              stroke="#617e68"
              strokeWidth="2"
            />
            <path d="M74 66h53" stroke="#617e68" strokeWidth="2" />
            <rect x="75" y="35" width="51" height="23" rx="8" fill="#5d7663" />
            <path
              d="M100 84v41"
              stroke="#d4e1d5"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M78 140h46" stroke="#617e68" strokeWidth="2" />
          </>
        )}
      </svg>
      <small>礼品示意 · 可上传实物图</small>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  error,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  error?: string;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {children}
      </section>
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span>
        <Icon name="gift" size={30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export const date = (v: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(v));
