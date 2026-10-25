// The plan's frame: a pane that scrolls once the plan is zoomed past the fit, and − Fit + to zoom it,
// under the plan on a phone and in the pane's bottom-right corner elsewhere. The zoom is a CSS variable
// (--zoom) that styles.css multiplies into the plan's size, so the drawing never re-renders for it, and a
// change keeps the middle of the view in place (keepCenter). App keys the frame by room, so a room opens
// at the fit, and the variants of one room share it, for comparing them at the same zoom.
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { FIT, ZOOM_STEPS, keepCenter, zoomIn, zoomOut } from "../zoom.ts";
import type { ScrollBox } from "../zoom.ts";

type Props = {
  /** The drawing's width over its height (planFrame): on a phone the frame keeps the fit's height. */
  ratio: number;
  /** A line beside the zoom buttons on a phone (what a tap on a piece does), or none. */
  tip: string | null;
  /** A click on the pane around the drawing, not on it. */
  onBackground: () => void;
  children: ReactNode;
};

const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? FIT;

const scrollBox = (el: HTMLElement): ScrollBox => ({
  scrollLeft: el.scrollLeft,
  scrollTop: el.scrollTop,
  clientWidth: el.clientWidth,
  clientHeight: el.clientHeight,
  scrollWidth: el.scrollWidth,
  scrollHeight: el.scrollHeight,
});

export function PlanZoom({ ratio, tip, onBackground, children }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const before = useRef<ScrollBox | null>(null);
  const [zoom, setZoom] = useState<number>(FIT);

  const change = (next: number) => {
    if (next === zoom) return;
    if (scroller.current) before.current = scrollBox(scroller.current);
    setZoom(next);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    const from = before.current;
    before.current = null;
    if (!el || !from) return;
    const { left, top } = keepCenter(from, scrollBox(el));
    el.scrollLeft = left;
    el.scrollTop = top;
  }, [zoom]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onBackground();
  };

  return (
    <>
      <div ref={scroller} className="plan-scroll" style={{ "--zoom": zoom, "--plan-ratio": ratio } as CSSProperties} onClick={onClick}>
        {children}
      </div>
      <div className="plan-tools">
        {tip && <p className="plan-tip">{tip}</p>}
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => change(zoomOut(zoom))} disabled={zoom <= FIT} aria-label="Zoom out" title="Zoom out">
            −
          </button>
          <button type="button" onClick={() => change(FIT)} disabled={zoom === FIT} title="Fit the whole room in view">
            Fit
          </button>
          <button type="button" onClick={() => change(zoomIn(zoom))} disabled={zoom >= MAX} aria-label="Zoom in" title="Zoom in">
            +
          </button>
        </div>
      </div>
    </>
  );
}
