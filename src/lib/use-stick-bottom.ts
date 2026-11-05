"use client";

import * as React from "react";

/** Writes the scroll position (kept out of the hook body: it is a DOM write, not React state). */
function setTop(el: HTMLElement, top: number) {
  el.scrollTop = top;
}

/**
 * Keeps a scrolling area glued to its end while its content grows (a chat or a log being written), with an eased,
 * frame-by-frame glide instead of a jump. Scrolling up by hand lets go; coming back to the end (or `scrollToEnd`)
 * sticks again. It follows size changes of `content`, so images and cards that grow later are followed too.
 */
export function useStickToBottom(scroller: React.RefObject<HTMLElement | null>, content: React.RefObject<HTMLElement | null>) {
  const stuckRef = React.useRef(true);
  const [stuck, setStuckState] = React.useState(true);
  const raf = React.useRef(0);
  const expected = React.useRef(-1); // the scrollTop we set ourselves, to tell our scrolls from the user's

  const setStuck = React.useCallback((v: boolean) => {
    stuckRef.current = v;
    setStuckState(v);
  }, []);

  const glide = React.useCallback(() => {
    const el = scroller.current;
    if (!el || raf.current) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      raf.current = 0;
      if (!stuckRef.current || !el.isConnected) return;
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      if (diff <= 0.5) return;
      // Exponential ease-out: quick when far, soft when close.
      const next = reduce || diff < 1.5 ? target : el.scrollTop + diff * 0.22;
      expected.current = next;
      setTop(el, next);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [scroller]);

  React.useEffect(() => {
    const el = scroller.current;
    const body = content.current;
    if (!el) return;
    setTop(el, el.scrollHeight); // opening a conversation lands on its end, no glide
    const ro = new ResizeObserver(() => stuckRef.current && glide());
    if (body) ro.observe(body);
    ro.observe(el);
    const away = () => stuckRef.current && setStuck(false);
    const onWheel = (e: WheelEvent) => e.deltaY < 0 && away();
    const touchY = { y: 0 };
    const onTouchStart = (e: TouchEvent) => void (touchY.y = e.touches[0]?.clientY ?? 0);
    const onTouchMove = (e: TouchEvent) => (e.touches[0]?.clientY ?? 0) > touchY.y + 4 && away();
    const onKey = (e: KeyboardEvent) => ["PageUp", "ArrowUp", "Home"].includes(e.key) && away();
    const onScroll = () => {
      if (Math.abs(el.scrollTop - expected.current) < 2) return; // our own glide
      const dist = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (dist <= 8) {
        if (!stuckRef.current) setStuck(true);
      } else if (dist > 64) away();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKey);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("scroll", onScroll);
    };
  }, [scroller, content, glide, setStuck]);

  const scrollToEnd = React.useCallback(() => {
    setStuck(true);
    glide();
  }, [glide, setStuck]);

  return { stuck, setStuck: (v: boolean) => (v ? scrollToEnd() : setStuck(false)), scrollToEnd };
}
