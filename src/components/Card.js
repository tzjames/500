import React from "react";
import { cardImageUrl } from "../theme";
import { isRed, isLeftBower } from "../cards";
import "./Card.css";

// One card, at whatever size the caller asks for. Two deck kinds render through
// here: an image deck paints a face from `cards/<deck>/<rank><suit>.jpg`, a
// glyph deck draws rank + suit character on the same paper. Face-down cards use
// the deck's back image, or the location's back gradient when it has none.
//
// `width` is the only dimension callers pass — height follows from the deck's
// 0.714 aspect, so every card in the app stays in proportion.
function Card({
  card,
  deck,
  width = 100,
  faceDown = false,
  selected = false,
  disabled = false,
  trumpSuit,
  badge,
  badgeTone = "kitty",
  rotate = 0,
  lift = 0,
  onClick,
  className = "",
  style = {},
}) {
  // Each of these is only written when the caller actually asked for it: an
  // inline custom property beats any stylesheet rule, so writing a default of
  // 0 here would silently override the lifts and sizes that CSS classes set
  // (the kitty badge lift, the viewport-scaled hand widths).
  const vars = {
    ...(width == null ? {} : { "--card-w": `${width}px` }),
    ...(rotate ? { "--card-rotate": `${rotate}deg` } : {}),
    ...(lift ? { "--card-lift": `${lift}px` } : {}),
    ...style,
  };

  const classes = [
    "pc",
    faceDown ? "pc-back" : "pc-face",
    selected ? "pc-selected" : "",
    disabled ? "pc-disabled" : "",
    onClick && !disabled ? "pc-clickable" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (faceDown) {
    return <div className={classes} style={vars} aria-hidden="true" />;
  }

  const imageUrl = cardImageUrl(card, deck);
  const label =
    card.suit === "Joker" ? "Joker" : `${card.value} ${card.suit}`;

  const handleClick = onClick && !disabled ? () => onClick(card) : undefined;
  const Tag = handleClick ? "button" : "div";

  return (
    <Tag
      className={classes}
      style={vars}
      onClick={handleClick}
      disabled={Tag === "button" ? disabled : undefined}
      type={Tag === "button" ? "button" : undefined}
      aria-label={label}
    >
      {imageUrl ? (
        <img className="pc-img" src={imageUrl} alt={label} draggable="false" />
      ) : (
        <GlyphFace card={card} />
      )}
      {badge && <span className={`pc-badge pc-badge-${badgeTone}`}>{badge}</span>}
      {trumpSuit && isLeftBower(card, trumpSuit) && (
        <span className="pc-bower" title="Left bower">
          LB
        </span>
      )}
    </Tag>
  );
}

// The drawn face for glyph decks: index at top-left, pip centred, repeated
// rotated 180° at bottom-right — the same treatment the image deck bakes in.
function GlyphFace({ card }) {
  if (card.suit === "Joker") {
    return (
      <span className="pc-glyph pc-glyph-joker">
        <span className="pc-joker-word">JOKER</span>
      </span>
    );
  }
  const tone = isRed(card.suit) ? "pc-red" : "pc-black";
  return (
    <span className={`pc-glyph ${tone}`}>
      <span className="pc-index pc-index-tl">
        <span className="pc-rank">{card.value}</span>
        <span className="pc-suit">{card.suit}</span>
      </span>
      <span className="pc-pip">{card.suit}</span>
      <span className="pc-index pc-index-br">
        <span className="pc-rank">{card.value}</span>
        <span className="pc-suit">{card.suit}</span>
      </span>
    </span>
  );
}

export default Card;
