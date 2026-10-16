import { createContext, useContext, useState, type ReactNode } from "react";
import { keyOf, type Media } from "./types";
function read(key: string): Media[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (m): m is Media =>
              !!m &&
              typeof m === "object" &&
              Number.isInteger(m.id) &&
              ["movie", "tv"].includes(m.media_type) &&
              typeof m.overview === "string",
          )
          .slice(0, 200)
      : [];
  } catch {
    return [];
  }
}
const Context = createContext<{
  saved: Media[];
  recent: Media[];
  warning: boolean;
  toggle: (m: Media) => void;
  visit: (m: Media) => void;
}>({
  saved: [],
  recent: [],
  warning: false,
  toggle: () => {},
  visit: () => {},
});
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState(() => read("movieboxd.saved"));
  const [recent, setRecent] = useState(() => read("movieboxd.recent"));
  const [warning, setWarning] = useState(false);
  function persist(key: string, data: Media[]) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      setWarning(true);
    }
  }
  function toggle(m: Media) {
    const next = saved.some((item) => keyOf(item) === keyOf(m))
      ? saved.filter((item) => keyOf(item) !== keyOf(m))
      : [m, ...saved].slice(0, 200);
    setSaved(next);
    persist("movieboxd.saved", next);
  }
  function visit(m: Media) {
    setRecent((current) => {
      const next = [
        m,
        ...current.filter((item) => keyOf(item) !== keyOf(m)),
      ].slice(0, 20);
      persist("movieboxd.recent", next);
      return next;
    });
  }
  return (
    <Context.Provider value={{ saved, recent, warning, toggle, visit }}>
      {children}
    </Context.Provider>
  );
}
export const useLibrary = () => useContext(Context);
