const test = require('node:test'), assert = require('node:assert/strict');
const { queueNextIndex, queuePrevIndex, queueInsertIndex, queueIndexAfterRemove, queueIndexAfterMove } = require('../queue.js');

test('next: walks forward, stops at the end, wraps when looping', () => {
  assert.equal(queueNextIndex(3, 0, false), 1);
  assert.equal(queueNextIndex(3, 1, false), 2);
  assert.equal(queueNextIndex(3, 2, false), -1, 'end of queue, no loop');
  assert.equal(queueNextIndex(3, 2, true), 0, 'end of queue, loop');
  assert.equal(queueNextIndex(3, -1, false), 0, 'nothing from the queue playing: start at the top');
  assert.equal(queueNextIndex(0, -1, true), -1, 'empty queue');
});

test('prev: walks back, stops at the start, wraps when looping', () => {
  assert.equal(queuePrevIndex(3, 2, false), 1);
  assert.equal(queuePrevIndex(3, 0, false), -1, 'first track, no loop: caller restarts the song');
  assert.equal(queuePrevIndex(3, 0, true), 2, 'first track, loop: last track');
  assert.equal(queuePrevIndex(3, -1, true), 2);
  assert.equal(queuePrevIndex(0, 0, true), -1, 'empty queue');
});

test('play next inserts after the playing track, or at the end when none is playing', () => {
  assert.equal(queueInsertIndex(4, 1), 2);
  assert.equal(queueInsertIndex(4, 3), 4);
  assert.equal(queueInsertIndex(4, -1), 4);
  assert.equal(queueInsertIndex(0, -1), 0);
});

test('removing a track keeps the playing pointer on the same track', () => {
  assert.equal(queueIndexAfterRemove(3, 1), 2, 'a track before the playing one: pointer moves back');
  assert.equal(queueIndexAfterRemove(1, 3), 1, 'a track after the playing one: pointer stays');
  assert.equal(queueIndexAfterRemove(2, 2), -1, 'the playing track itself: detached');
  assert.equal(queueIndexAfterRemove(-1, 0), -1, 'nothing playing from the queue stays that way');
});

test('moving a track keeps the playing pointer on the same track', () => {
  assert.equal(queueIndexAfterMove(1, 1, 3), 3, 'the playing track itself moves along');
  assert.equal(queueIndexAfterMove(2, 0, 3), 1, 'a track dragged from before the playing one to after it: pointer moves back');
  assert.equal(queueIndexAfterMove(1, 3, 0), 2, 'a track dragged from after the playing one to before it: pointer moves forward');
  assert.equal(queueIndexAfterMove(1, 0, 2), 0, 'a move that does not cross the playing track: pointer moves back with the list');
  assert.equal(queueIndexAfterMove(-1, 0, 3), -1, 'nothing from the queue playing: stays detached');
});

test('moving tracks always follows the playing track (exhaustive, queues up to 7)', () => {
  for (let n = 1; n <= 7; n++) for (let idx = -1; idx < n; idx++) for (let from = 0; from < n; from++) for (let to = 0; to < n; to++) {
    const list = Array.from({ length: n }, (_, i) => i);
    const playing = idx >= 0 ? list[idx] : -1;
    const [t] = list.splice(from, 1); list.splice(to, 0, t);
    const expected = playing < 0 ? -1 : list.indexOf(playing);
    assert.equal(queueIndexAfterMove(idx, from, to), expected, `n=${n} idx=${idx} from=${from} to=${to}`);
  }
});
