import React from "react";
import { Link } from "react-router-dom";
import "./BrandMark.css";

// The mark in the table's top-left corner, and the way back to your games.
//
// The white-ink cut, since every backdrop behind it is a dark photograph. The
// artwork is transparent, so it sits on the felt as loose cards and a wordmark
// rather than as a badge with an edge.
function BrandMark({ title = "Back to your games" }) {
  return (
    <Link to="/" className="brand-mark" title={title}>
      <img src="/brand/logo-dark-bg.png" alt="Tricky Games" width="810" height="301" />
    </Link>
  );
}

export default BrandMark;
