#!/usr/bin/env node
// Run with: node tests/test_engine.js
// Headless tests for Takuzu.js. Uniqueness is checked with an independent brute-force
// counter that shares no code with the logic rules the generator uses.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "Takuzu.js"), "utf8")
    .replace(/^\.pragma library\s*$/m, "");
const T = new Function(src + `
return { LEVELS, levelNames, makeRng, generate, propagate, countSolutions, conflicts, hasConflicts,
         isSolved, newState, setCell, cycleCell, nextValue, undo, hint, applyHint, wrongCells,
         progress, encodeState, decodeState, formatTime, rulesOnce, lineCompletions, fullSolution, emptyBoard };`)();

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log("ok   - " + name); }
    catch (e) { console.log("FAIL - " + name + "\n       " + e.message); process.exitCode = 1; }
}
const SEEDS = 40;

test("generation is deterministic per seed and differs between seeds", () => {
    for (const l of T.levelNames()) {
        assert.deepStrictEqual(T.generate(l, 7), T.generate(l, 7));
        assert.notDeepStrictEqual(T.generate(l, 7).solution, T.generate(l, 8).solution);
    }
});

test("solutions obey every rule", () => {
    for (const l of T.levelNames())
        for (let s = 1; s <= SEEDS; s++) {
            const g = T.generate(l, s);
            assert.ok(T.isSolved(g.solution, g.n), l + " seed " + s);
        }
});

test("every puzzle has exactly ONE solution (independent brute force)", () => {
    for (const l of T.levelNames())
        for (let s = 1; s <= SEEDS; s++) {
            const g = T.generate(l, s);
            assert.strictEqual(T.countSolutions(g.puzzle, g.n, 3), 1, l + " seed " + s);
        }
});

test("givens never contradict the solution and match the level's density", () => {
    for (const l of T.levelNames()) {
        const lv = T.LEVELS[l];
        for (let s = 1; s <= SEEDS; s++) {
            const g = T.generate(l, s);
            g.puzzle.forEach((v, i) => { if (v !== -1) assert.strictEqual(v, g.solution[i]); });
            const frac = g.puzzle.filter(v => v !== -1).length / (g.n * g.n);
            assert.ok(frac >= lv.keep - 0.06 && frac <= lv.keep + 0.12, l + " seed " + s + " " + frac.toFixed(2));
        }
    }
});

test("easy and medium are solvable with the two basic rules, hard needs line reasoning", () => {
    let hardNeedsMore = 0;
    for (let s = 1; s <= SEEDS; s++) {
        for (const l of ["easy", "medium"]) {
            const g = T.generate(l, s);
            assert.ok(T.propagate(g.puzzle, g.n, 1).complete, l + " seed " + s);
        }
        const h = T.generate("hard", s);
        assert.ok(T.propagate(h.puzzle, h.n, 2).complete, "hard seed " + s + " not logic-solvable");
        if (!T.propagate(h.puzzle, h.n, 1).complete) hardNeedsMore++;
    }
    assert.ok(hardNeedsMore >= SEEDS * 0.9, "only " + hardNeedsMore + "/" + SEEDS + " hard puzzles need tier 2");
});

test("logic never deduces a wrong value (soundness)", () => {
    for (const l of T.levelNames())
        for (let s = 1; s <= 25; s++) {
            const g = T.generate(l, s);
            const r = T.propagate(g.puzzle, g.n, 2);
            r.board.forEach((v, i) => assert.strictEqual(v, g.solution[i]));
        }
});

test("rule detection: triples, over-counts and duplicate lines are flagged", () => {
    const n = 6, b = T.emptyBoard(n);
    [0, 1, 2].forEach(i => b[i] = 0);                   // 000 in row 0
    const c = T.conflicts(b, n);
    assert.ok(c[0] && c[1] && c[2] && !c[3]);
    const b2 = T.emptyBoard(n);                          // four 1s in a row of six
    [0, 1, 3, 4].forEach(i => b2[i] = 1);
    assert.ok(T.conflicts(b2, n)[0]);
    const g = T.generate("easy", 3), b3 = g.solution.slice();
    for (let c2 = 0; c2 < 6; c2++) b3[6 + c2] = b3[c2];  // copy row 0 into row 1
    assert.ok(T.hasConflicts(b3, 6));
    assert.ok(!T.isSolved(g.puzzle, 6));
});

test("a valid but different grid is not 'solved' unless it satisfies all rules", () => {
    const g = T.generate("medium", 5);
    const b = g.solution.slice();
    b[0] = 1 - b[0];
    assert.ok(!T.isSolved(b, g.n));
});

test("placing values: given cells are locked, mistakes are counted, win is detected", () => {
    const g = T.generate("easy", 11), s = T.newState(g);
    const given = s.given.indexOf(true);
    assert.strictEqual(T.setCell(s, given, 1 - s.solution[given]).changed, false);
    const free = s.given.indexOf(false);
    const wrong = 1 - s.solution[free];
    let r = T.setCell(s, free, wrong);
    assert.ok(r.changed && r.mistake && s.mistakes === 1);
    assert.deepStrictEqual(T.wrongCells(s), [free]);
    r = T.setCell(s, free, s.solution[free]);
    assert.ok(r.changed && !r.mistake && s.mistakes === 1);
    s.cells.forEach((v, i) => { if (!s.given[i]) T.setCell(s, i, s.solution[i]); });
    assert.ok(s.won);
    assert.strictEqual(T.setCell(s, free, -1).changed, false);   // locked after the win
});

test("cycle goes empty -> 0 -> 1 -> empty; undo restores, mistakes are not refunded", () => {
    const s = T.newState(T.generate("easy", 2));
    const i = s.given.indexOf(false);
    assert.strictEqual(T.nextValue(-1), 0);
    assert.strictEqual(T.nextValue(0), 1);
    assert.strictEqual(T.nextValue(1), -1);
    T.cycleCell(s, i); T.cycleCell(s, i);
    assert.strictEqual(s.cells[i], 1);
    const before = s.mistakes;
    assert.ok(T.undo(s));
    assert.strictEqual(s.cells[i], 0);
    assert.ok(s.mistakes >= before);
    while (T.undo(s)) { }
    assert.deepStrictEqual(s.cells, s.puzzle);
});

test("hints: always correct, wrong entries come first, solving by hints alone wins", () => {
    for (const l of T.levelNames())
        for (let seed = 1; seed <= 15; seed++) {
            const s = T.newState(T.generate(l, seed));
            const free = s.given.map((g, i) => g ? -1 : i).filter(i => i >= 0);
            const rng = T.makeRng(seed * 31);
            free.forEach(i => { if (rng() < 0.3) T.setCell(s, i, s.solution[i]); });
            const h = T.hint(s);
            assert.strictEqual(h.value, s.solution[h.idx], l + " " + seed);
            assert.strictEqual(h.kind, "logic");
            // a wrong entry takes priority
            const e = free.find(i => s.cells[i] === -1);
            if (e !== undefined) {
                T.setCell(s, e, 1 - s.solution[e]);
                const h2 = T.hint(s);
                assert.strictEqual(h2.kind, "wrong");
                assert.strictEqual(h2.idx, e);
            }
        }
    const s = T.newState(T.generate("hard", 4));
    let guard = 0;
    while (!s.won && guard++ < 200) assert.ok(T.applyHint(s));
    assert.ok(s.won);
    assert.ok(s.hints > 0);
    assert.strictEqual(s.mistakes, 0);
});

test("hint reasons explain a real rule", () => {
    const s = T.newState(T.generate("hard", 9));
    const seen = new Set();
    let guard = 0;
    while (!s.won && guard++ < 200) { seen.add(T.hint(s).reason.split(" ")[0]); T.applyHint(s); }
    assert.ok(seen.size >= 2, [...seen].join(","));
});

test("save/load round-trips and rejects damaged data", () => {
    const s = T.newState(T.generate("medium", 6));
    T.cycleCell(s, s.given.indexOf(false));
    const back = T.decodeState(JSON.parse(JSON.stringify(T.encodeState(s))));
    assert.deepStrictEqual(back.cells, s.cells);
    assert.deepStrictEqual(back.solution, s.solution);
    assert.strictEqual(back.mistakes, s.mistakes);
    const bad = JSON.parse(JSON.stringify(T.encodeState(s)));
    for (const mut of [
        o => { o.cells = o.cells.slice(1); },
        o => { o.level = "nope"; },
        o => { o.solution = o.solution.replace(/[01]/, "x"); },
        o => { o.solution = "0".repeat(o.solution.length); },
        o => { o.cells = o.puzzle.replace(/[01]/, c => c === "0" ? "1" : "0"); },
    ]) {
        const o = JSON.parse(JSON.stringify(bad)); mut(o);
        assert.strictEqual(T.decodeState(o), null);
    }
    assert.strictEqual(T.decodeState(null), null);
    assert.strictEqual(T.decodeState("junk"), null);
});

test("progress and time formatting", () => {
    const s = T.newState(T.generate("easy", 1));
    assert.strictEqual(T.progress(s), 0);
    s.cells.forEach((v, i) => { if (!s.given[i]) s.cells[i] = s.solution[i]; });
    assert.strictEqual(T.progress(s), 1);
    assert.strictEqual(T.formatTime(0), "00:00");
    assert.strictEqual(T.formatTime(65), "01:05");
    assert.strictEqual(T.formatTime(3599.9), "59:59");
    assert.strictEqual(T.formatTime(-4), "00:00");
});

test("generation is fast enough to run on the UI thread", () => {
    for (const l of T.levelNames()) {
        const t = Date.now();
        for (let s = 100; s < 120; s++) T.generate(l, s);
        const per = (Date.now() - t) / 20;
        assert.ok(per < 150, l + " took " + per + " ms per puzzle");
    }
});

console.log("\n" + passed + " passed");
