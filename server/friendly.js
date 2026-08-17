// A game is friendly — it doesn't move anyone's Elo — either because someone
// marked it that way when it was started, or because a robot is sitting at it.
// A robot has no rating to win or lose, so a table with one can never be rated,
// whatever was chosen when the game was created. One place to compute this so
// the lobby, the games list and the stats page can't disagree about a game
// they're all reading the same two fields off of.
function isFriendlyGame(doc) {
  return Boolean(doc?.friendly) || (doc?.playerSlots || []).some((s) => s?.isBot);
}

module.exports = { isFriendlyGame };
