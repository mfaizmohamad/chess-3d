// Perft and rules sanity tests. Run: node test/perft.mjs
import { Chess, START_FEN, nameSq } from '../src/rules.js';

let fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got}${ok ? '' : ' (want ' + want + ')'}`);
};
const KIWI = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POS4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
const POS5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8';

const c = new Chess(START_FEN);
c.trackKeys = false;
[20, 400, 8902, 197281].forEach((w, i) => check(`start d${i + 1}`, c.perft(i + 1), w));
const k = new Chess(KIWI); k.trackKeys = false;
[48, 2039, 97862].forEach((w, i) => check(`kiwipete d${i + 1}`, k.perft(i + 1), w));
const p3 = new Chess(POS3); p3.trackKeys = false;
[14, 191, 2812, 43238].forEach((w, i) => check(`pos3 d${i + 1}`, p3.perft(i + 1), w));
const p4 = new Chess(POS4); p4.trackKeys = false;
[6, 264, 9467].forEach((w, i) => check(`pos4 d${i + 1}`, p4.perft(i + 1), w));
const p5 = new Chess(POS5); p5.trackKeys = false;
[44, 1486, 62379].forEach((w, i) => check(`pos5 d${i + 1}`, p5.perft(i + 1), w));

// SAN and endings
const g = new Chess();
const seq = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
const sans = seq.map((s) => g.play({ from: nameSq(s.slice(0, 2)), to: nameSq(s.slice(2)) }).san);
check('fools mate san', sans.join(' '), 'f3 e5 g4 Qh4#');
const st = g.status();
check('fools mate status', st.reason + ' ' + st.result, 'checkmate 0-1');
g.undo(); g.undo();
check('undo fen', g.fen().split(' ').slice(0, 4).join(' '), 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6');

const stale = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
check('stalemate', stale.status().reason, 'stalemate');
const ins = new Chess('8/8/4k3/8/8/3NK3/8/8 w - - 0 1');
check('insufficient', ins.status().reason, 'insufficient material');
const ep = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
const epm = ep.play({ from: nameSq('e5'), to: nameSq('f6') });
check('en passant san', epm.san, 'exf6');
const promo = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
check('promo moves', promo.moves().filter((m) => m.promo).length, 4);
const pm = promo.play({ from: nameSq('a7'), to: nameSq('a8'), promo: 'q' });
check('promo san', pm.san, 'a8=Q');
const dis = new Chess('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
const cm = dis.play({ from: 4, to: 6 });
check('castle san', cm.san, 'O-O');
// threefold
const t = new Chess();
for (let i = 0; i < 2; i++) for (const s of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) t.play({ from: nameSq(s.slice(0, 2)), to: nameSq(s.slice(2)) });
check('threefold', t.status().reason, 'threefold repetition');

console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
