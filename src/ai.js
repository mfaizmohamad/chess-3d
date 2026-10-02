// Tiny alpha-beta engine. Runs as a generator so the caller can time-slice it across frames.
import { Chess } from './rules.js';

const VAL = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
const MATE = 100000;

// Piece-square bonuses from white's point of view, index = rank * 8 + file (rank 0 = white's back rank).
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5, 5, 5, 5, 5, 0, -10, 0, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20, -10, -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30],
};

function evaluate(ch) {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = ch.board[i];
    if (!p) continue;
    const t = p.toLowerCase();
    if (p < 'a') s += VAL[t] + PST[t][i];
    else s -= VAL[t] + PST[t][(7 - (i >> 3)) * 8 + (i & 7)];
  }
  return ch.turn === 'w' ? s : -s;
}

function order(ms) {
  for (const m of ms) m.score = (m.captured ? 10 * VAL[m.captured] - VAL[m.piece] / 10 : 0) + (m.promo ? VAL[m.promo] : 0);
  ms.sort((a, b) => b.score - a.score);
}

function* negamax(ch, depth, alpha, beta, ply, ctl) {
  ctl.nodes++;
  if ((ctl.nodes & 127) === 0) yield;
  if (depth === 0) return evaluate(ch);
  const ms = ch.moves();
  if (!ms.length) return ch.inCheck() ? -MATE + ply : 0;
  order(ms);
  let best = -Infinity;
  for (const m of ms) {
    ch._make(m, false);
    const v = -(yield* negamax(ch, depth - 1, -beta, -alpha, ply + 1, ctl));
    ch._unmake();
    if (v > best) { best = v; if (ply === 0) ctl.best = m; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

// Generator: drive with .next() until done; result value is { move, score, nodes }.
// Every root move is scored with a full window so near-equal moves can be chosen at random (margin in centipawns).
export function* searchMove(fen, depth = 2, margin = depth <= 2 ? 50 : depth === 3 ? 20 : 8) {
  const ch = new Chess(fen);
  ch.trackKeys = false;
  const ctl = { nodes: 0, best: null };
  const ms = ch.moves();
  if (!ms.length) return { move: null, score: 0, nodes: 0 };
  order(ms);
  const scored = [];
  for (const m of ms) {
    ch._make(m, false);
    const v = -(yield* negamax(ch, depth - 1, -Infinity, Infinity, 1, ctl));
    ch._unmake();
    scored.push({ m, v });
  }
  const top = Math.max(...scored.map((x) => x.v));
  const pool = scored.filter((x) => x.v >= top - margin);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { move: pick.m, score: pick.v, nodes: ctl.nodes };
}
