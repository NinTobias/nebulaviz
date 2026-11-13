// --- Playlist navigation: pure index logic (no DOM), so it can be tested with Node. ---
// idx is the index of the playing track in the queue; -1 means nothing from the queue is playing.
// loop = wrap around at the ends of the queue.

// The track to play after idx, or -1 when the queue is finished.
function queueNextIndex(len, idx, loop) {
  if (!len) return -1;
  if (idx + 1 < len) return idx + 1;
  return loop ? 0 : -1;
}

// The track to play before idx, or -1 when there is none (the caller then restarts the current track).
function queuePrevIndex(len, idx, loop) {
  if (!len) return -1;
  if (idx > 0) return idx - 1;
  return loop ? len - 1 : -1;
}

// Where "Play next" puts a new track: right after the playing one, or at the end when nothing from the queue is playing.
function queueInsertIndex(len, idx) {
  return idx >= 0 ? idx + 1 : len;
}

// The playing index after the track at `removed` has been taken out of the queue.
// Removing the playing track itself leaves the song audible but detached from the queue (-1).
function queueIndexAfterRemove(idx, removed) {
  if (removed < idx) return idx - 1;
  if (removed === idx) return -1;
  return idx;
}

// The playing index after the track at `from` has been dragged to position `to` (its final index in the reordered queue).
function queueIndexAfterMove(idx, from, to) {
  if (idx === from) return to;
  if (from < idx && to >= idx) return idx - 1;
  if (from > idx && to <= idx) return idx + 1;
  return idx;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { queueNextIndex, queuePrevIndex, queueInsertIndex, queueIndexAfterRemove, queueIndexAfterMove };   // lets the Node tests load this file; in the browser it is a plain script