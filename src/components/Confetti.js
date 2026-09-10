import React, { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import "./Confetti.css";

// Won it. Two bursts in from the bottom corners, then a couple of smaller ones
// on a timer, so the celebration lasts as long as it takes to read the result
// rather than being over before you look up.
//
// canvas-confetti takes care of the physics — and of prefers-reduced-motion,
// which the hand-rolled version this replaced did not: anyone who has asked for
// less motion gets none of this.
//
// It renders onto a canvas of its own rather than using the library's shared
// global one. The global instance nulls its canvas the moment an animation
// finishes, which races a component unmounting — and under StrictMode, which
// mounts, cleans up and mounts again, that race throws. An instance scoped to
// our own element has no such lifecycle to collide with.

// The table's palette rather than a generic rainbow: the amber the app
// highlights with, cream, and the felt greens under it.
const COLORS = ["#ffe1aa", "#f6d38a", "#fdf6e6", "#8fbf9f", "#4f8f6d", "#d8a24a"];

const BURST = {
  particleCount: 70,
  spread: 70,
  startVelocity: 55,
  ticks: 260,
  colors: COLORS,
};

function Confetti() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const fire = confetti.create(canvas, { resize: true, disableForReducedMotion: true });
    // In from both bottom corners, angled towards the middle.
    fire({ ...BURST, origin: { x: 0, y: 0.9 }, angle: 60 });
    fire({ ...BURST, origin: { x: 1, y: 0.9 }, angle: 120 });

    const timers = [700, 1500].map((delay) =>
      setTimeout(() => {
        fire({
          ...BURST,
          particleCount: 40,
          spread: 100,
          startVelocity: 40,
          origin: { x: 0.5, y: 0.7 },
          angle: 90,
        });
      }, delay)
    );

    return () => {
      timers.forEach(clearTimeout);
      fire.reset();
    };
  }, []);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}

export default Confetti;
