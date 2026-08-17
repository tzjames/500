import React from "react";
import "./StatsCharts.css";

// How close your own contracts came to what you promised, across every game.
// Zero is exactly what you bid; to the right is tricks you didn't need, to the
// left is the ones you were short. Bidding high and landing on the nose is the
// tall bar in the middle; a heap on the left is a habit of overbidding.
//
// Numeric contracts only — "over by one" means nothing for a Misère, which is
// either clean or broken.
function AccuracyChart({ accuracy = [], total = 0 }) {
  if (total === 0) {
    return (
      <p className="stats-empty">
        Nothing here yet — this fills in as you win contracts with a number on them.
      </p>
    );
  }

  // A fixed span either side of the mark, so the shape of two different players'
  // charts can be compared at a glance. Anything beyond the ends is folded into
  // the end bucket rather than dropped.
  const SPAN = 4;
  const buckets = [];
  for (let diff = -SPAN; diff <= SPAN; diff++) {
    const count = accuracy
      .filter((a) => (diff === -SPAN ? a.diff <= diff : diff === SPAN ? a.diff >= diff : a.diff === diff))
      .reduce((sum, a) => sum + a.count, 0);
    buckets.push({ diff, count });
  }
  const most = Math.max(1, ...buckets.map((b) => b.count));

  const label = (diff) =>
    diff === 0
      ? "exact"
      : diff > 0
      ? `+${diff}${diff === SPAN ? "+" : ""}`
      : `${diff}${diff === -SPAN ? "−" : ""}`;

  return (
    <div className="accuracy">
      <div className="accuracy-bars">
        {buckets.map((bucket) => {
          const percent = Math.round((bucket.count / total) * 100);
          return (
            <div
              key={bucket.diff}
              className={`accuracy-col${bucket.diff === 0 ? " exact" : ""}${
                bucket.diff < 0 ? " short" : ""
              }`}
              title={`${bucket.count} of ${total} contracts (${percent}%)`}
            >
              <span className="accuracy-value">{bucket.count ? `${percent}%` : ""}</span>
              <span
                className="accuracy-bar"
                style={{ height: `${Math.round((bucket.count / most) * 100)}%` }}
              />
              <span className="accuracy-label">{label(bucket.diff)}</span>
            </div>
          );
        })}
      </div>
      <p className="stats-note">
        Tricks taken against tricks promised, over {total} numbered contract
        {total === 1 ? "" : "s"}. Left of the mark is short — a broken contract; right of it
        is tricks you didn&apos;t need to promise.
      </p>
    </div>
  );
}

export default AccuracyChart;
