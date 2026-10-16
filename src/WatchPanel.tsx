import { useEffect, useRef, useState } from "react";
import { MonitorPlay, X } from "lucide-react";
import { titleOf, type Media } from "./types";
import "./watch.css";
import DirectLinks from "./DirectLinks";

function WatchPanel({ movie, onClose }: { movie: Media; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    const focused = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el.showModal();
    return () => {
      el.close();
      document.body.style.overflow = previous;
      focused?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="watch-dialog"
      aria-labelledby="watch-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="watch-header">
        <div className="watch-header-icon">
          <MonitorPlay size={23} />
        </div>
        <div>
          <span className="eyebrow">ВАШ СЛЕДУЮЩИЙ КИНОВЕЧЕР</span>
          <h2 id="watch-title">Где смотреть</h2>
          <p>{titleOf(movie)}</p>
        </div>
        <button
          autoFocus
          className="watch-close icon-button"
          aria-label="Закрыть панель просмотра"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="watch-body">
        <DirectLinks movie={movie} />
      </div>
    </dialog>
  );
}
export default function WatchButton({ movie }: { movie: Media }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="button primary" onClick={() => setOpen(true)}>
        <MonitorPlay size={18} /> Где смотреть
      </button>
      {open && <WatchPanel movie={movie} onClose={() => setOpen(false)} />}
    </>
  );
}
