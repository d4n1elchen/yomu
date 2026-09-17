'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MAX_BAND } from '../lib/marking.ts';

/**
 * The reader's two settings, behind one floating button.
 *
 * They used to sit as two ruled bars between the title and the text, which on a
 * phone pushed the first paragraph halfway down the screen for controls that
 * are set once and then left alone. A corner button keeps them a tap away from
 * anywhere in a long chapter, where the bars were only reachable from the top.
 */
export function ReaderSettings({
  explain,
  onExplainChange,
  level,
  onLevelChange,
  dictionaryReady,
  markedCount,
}: {
  explain: boolean;
  onExplainChange: (explain: boolean) => void;
  level: number;
  onLevelChange: (level: number) => void;
  /** Without JMdict there is nothing to grade by, so the slider hides itself. */
  dictionaryReady: boolean;
  markedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Closes on a tap anywhere else -- including on the text, so tapping a word
  // closes the panel and opens its card in the one gesture.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="reader-settings" ref={rootRef}>
      {open ? (
        <div className="reader-settings-panel" id={panelId} role="group" aria-label="閱讀設定">
          <label className={`switch ${explain ? 'on' : ''}`}>
            <span className="switch-label">詞彙解說</span>
            <input
              type="checkbox"
              checked={explain}
              onChange={(event) => onExplainChange(event.target.checked)}
            />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-knob" />
            </span>
          </label>

          {dictionaryReady && explain ? (
            <div className="level-control">
              <div className="level-head">
                <span className="level-label">難易度</span>
                <span className="level-count">已標記 {markedCount} 個詞</span>
              </div>
              <input
                type="range"
                min={1}
                max={MAX_BAND}
                step={1}
                value={level}
                onChange={(event) => onLevelChange(Number(event.target.value))}
                aria-label="難易度：往右代表已知的詞越多，標記越少"
              />
              <div className="level-ends" aria-hidden="true">
                <span>初級</span>
                <span>進階</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className={`reader-settings-button ${open ? 'open' : ''}`}
        aria-label="閱讀設定"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M4 7h9M17 7h3M4 17h3M11 17h9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="15" cy="7" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="9" cy="17" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
    </div>
  );
}
