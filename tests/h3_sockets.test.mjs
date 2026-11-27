import assert from 'node:assert/strict';
import test from 'node:test';
import { INPUT_NAMES, OUTPUT_NAMES, dropTarget, setSocketHidden, socketsToShow } from '../js/shared/h3_sockets.mjs';

const BASE_IN = ['clip', 'picture_1', 'video', 'voice', 'song'];
const BASE_OUT = ['prompt', 'frames', 'width', 'height'];
const sorted = (names) => [...new Set(names)].sort();
const shows = (wiredInputs, wiredOutputs = [], showAll = false) => {
  const { inputs, outputs } = socketsToShow({ wiredInputs, wiredOutputs, showAll });
  return { inputs: sorted(inputs), outputs: sorted(outputs) };
};
const expectShown = (wiredInputs, moreInputs, moreOutputs) => {
  const got = shows(wiredInputs);
  assert.deepEqual(got.inputs, sorted([...BASE_IN, ...moreInputs]), `inputs with ${wiredInputs.join(', ') || 'nothing'} wired`);
  assert.deepEqual(got.outputs, sorted([...BASE_OUT, ...moreOutputs]), `outputs with ${wiredInputs.join(', ') || 'nothing'} wired`);
};

test('the socket names are the node\'s own, in its order', () => {
  assert.deepEqual(INPUT_NAMES, ['clip', 'picture_1', 'picture_2', 'picture_3', 'picture_4', 'video', 'video_sound', 'voice', 'song']);
  assert.deepEqual(OUTPUT_NAMES, ['prompt', 'picture_1', 'picture_2', 'picture_3', 'picture_4', 'video', 'video_sound', 'voice', 'song', 'song_under', 'frames', 'width', 'height', 'keeps_clip_sound']);
});

test('a fresh node shows five inputs and four outputs', () => expectShown([], [], []));
test('one picture shows the next picture input and its own output', () => expectShown(['picture_1'], ['picture_2'], ['picture_1']));
test('two pictures show a third input and two outputs', () => expectShown(['picture_1', 'picture_2'], ['picture_2', 'picture_3'], ['picture_1', 'picture_2']));
test('a picture on the third input shows every picture input and one packed output', () => expectShown(['picture_3'], ['picture_2', 'picture_3', 'picture_4'], ['picture_1']));
test('four pictures show four inputs and four outputs', () => {
  const all = ['picture_1', 'picture_2', 'picture_3', 'picture_4'];
  expectShown(all, all, all);
});
test('a video shows its sound input, its output and the keeps-sound flag', () => expectShown(['video'], ['video_sound'], ['video', 'keeps_clip_sound']));
test('a video with its sound shows both outputs', () => expectShown(['video', 'video_sound'], ['video_sound'], ['video', 'video_sound', 'keeps_clip_sound']));
test('a video sound alone shows its own row but no keeps-sound flag', () => expectShown(['video_sound'], ['video_sound'], ['video_sound']));
test('a voice shows the voice output', () => expectShown(['voice'], [], ['voice']));
test('a song shows the song output', () => expectShown(['song'], [], ['song']));
test('a voice and a song show the song to mix under', () => expectShown(['voice', 'song'], [], ['voice', 'song', 'song_under']));

test('an output with a wire on it always shows', () => {
  assert.deepEqual(shows([], ['song_under']).outputs, sorted([...BASE_OUT, 'song_under']));
});

test('show all returns every socket', () => {
  const got = shows([], [], true);
  assert.deepEqual(got.inputs, sorted(INPUT_NAMES));
  assert.deepEqual(got.outputs, sorted(OUTPUT_NAMES));
});

test('pulling the second picture\'s wire drops its output again', () => {
  assert.ok(shows(['picture_1', 'picture_2']).outputs.includes('picture_2'));
  const after = shows(['picture_1']);
  assert.equal(after.outputs.includes('picture_2'), false);
  assert.equal(after.inputs.includes('picture_3'), false);
});

const audioInputs = ({ voice = false, song = false, videoSoundShown = false } = {}) => [
  { name: 'video', type: 'IMAGE', wired: false, shown: true },
  { name: 'video_sound', type: 'AUDIO', wired: true, shown: videoSoundShown },
  { name: 'voice', type: 'AUDIO', wired: voice, shown: true },
  { name: 'song', type: 'AUDIO', wired: song, shown: true },
];

test('a wire that lands on a hidden socket moves to the first shown free one of its kind', () => {
  assert.equal(dropTarget(audioInputs(), 1), 2);
  assert.equal(dropTarget(audioInputs({ voice: true }), 1), 3);
});

test('a dropped wire stays put when nothing shown is free, or when it landed on a shown socket', () => {
  assert.equal(dropTarget(audioInputs({ voice: true, song: true }), 1), 1);
  assert.equal(dropTarget(audioInputs({ videoSoundShown: true }), 1), 1);
  assert.equal(dropTarget(audioInputs(), 9), 9);
});

// A socket as the frontend makes it: draw and drawCollapsed live on its class.
class Socket {
  constructor(name) { this.name = name; }
  draw() { return 'drawn'; }
  drawCollapsed() { return 'drawn collapsed'; }
}
const own = (slot, key) => Object.prototype.hasOwnProperty.call(slot, key);

test('hiding a socket parks it and silences its drawing', () => {
  const slot = new Socket('picture_2');
  assert.equal(setSocketHidden(slot, true), true);
  assert.equal(slot._ausbossHidden, true);
  assert.ok(Array.isArray(slot.pos), 'a position takes the socket out of the stacked rows');
  assert.equal(slot.draw(), undefined);
  assert.equal(slot.drawCollapsed(), undefined);
});

test('showing a socket again leaves it exactly as the frontend made it', () => {
  const slot = new Socket('picture_2');
  setSocketHidden(slot, true);
  assert.equal(setSocketHidden(slot, false), true);
  assert.equal(slot._ausbossHidden, false);
  for (const key of ['pos', 'draw', 'drawCollapsed']) assert.equal(own(slot, key), false, key);
  assert.equal(slot.draw(), 'drawn');
});

test('a socket with no draw of its own kind is left alone and stays visible', () => {
  const slot = { name: 'x' };
  assert.equal(setSocketHidden(slot, true), false);
  assert.equal(own(slot, 'pos'), false);
  assert.equal(Boolean(slot._ausbossHidden), false);
});

test('a socket that came with its own position is never hidden and keeps it', () => {
  const slot = new Socket('placed');
  slot.pos = [10, 20];
  assert.equal(setSocketHidden(slot, true), false);
  assert.deepEqual(slot.pos, [10, 20]);
  setSocketHidden(slot, false);
  assert.deepEqual(slot.pos, [10, 20]);
});
