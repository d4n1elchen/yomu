'use client';

import { useLayoutEffect, useRef } from 'react';

/** The thing a card is hanging off, in viewport coordinates. */
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

/** Breathing room between a card and both its anchor and the viewport edge. */
export const CARD_GAP = 12;

/**
 * Hangs a card off something in the page without letting it run off screen.
 *
 * Written once and shared by the Q&A card and the word card. Measuring the
 * rendered card rather than assuming its size is what keeps the size a pure CSS
 * decision -- widening one of them must not mean remembering to change a number
 * in here too. `useLayoutEffect` runs before paint, so the corrected position is
 * the first one drawn and the card never visibly jumps.
 *
 * The card is also capped to the room on the side it was placed. The Q&A card
 * opens holding only a greeting and grows as the conversation does, so
 * positioning it once against its opening height would let a card near the
 * bottom of the window grow straight off the screen.
 *
 * On a narrow screen both cards are bottom sheets positioned entirely by CSS,
 * which reads none of these custom properties -- so writing them is harmless
 * there rather than needing a branch.
 */
export function useCardAnchor<T extends HTMLElement>(rect: AnchorRect) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;

    const { top, bottom, left } = rect;
    const spaceBelow = window.innerHeight - bottom - CARD_GAP * 2;
    const spaceAbove = top - CARD_GAP * 2;
    const below = spaceBelow >= spaceAbove;

    card.style.setProperty(
      '--card-room',
      `${Math.max(0, below ? spaceBelow : spaceAbove)}px`,
    );

    // Read after writing the cap, so this is the height that will be painted
    // rather than the uncapped one.
    const { width, height } = card.getBoundingClientRect();

    const x = Math.min(
      Math.max(CARD_GAP, left),
      Math.max(CARD_GAP, window.innerWidth - width - CARD_GAP),
    );
    const y = below ? bottom + CARD_GAP : Math.max(CARD_GAP, top - CARD_GAP - height);

    card.style.setProperty('--card-x', `${x}px`);
    card.style.setProperty('--card-y', `${y}px`);
    // Primitives, not the rect object: a re-render that rebuilds an identical
    // rect must not re-run the measurement.
  }, [rect.top, rect.bottom, rect.left]);

  return ref;
}

/**
 * The opening guess, before there is anything to measure. Needs no knowledge of
 * the card's size; the layout effect corrects it.
 */
export function anchorStyle(rect: AnchorRect): React.CSSProperties {
  return {
    '--card-x': `${rect.left}px`,
    '--card-y': `${rect.bottom + CARD_GAP}px`,
  } as React.CSSProperties;
}
