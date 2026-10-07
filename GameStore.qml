import QtQuick
import Quickshell
import Quickshell.Io

// Everything that survives a restart: last difficulty, per-level stats and the
// puzzle in progress. One small JSON file in ~/.local/state/omarchy-omatakuzu.
// The shell only ever stores numbers and 0/1/. strings here.
Item {
    id: root

    property string dir: (Quickshell.env("XDG_STATE_HOME")
        || Quickshell.env("HOME") + "/.local/state") + "/omarchy-omatakuzu"
    property string path: dir + "/state.json"

    property bool loaded: false
    property string level: "easy"
    property var stats: blankStats()
    property var saved: null            // encoded game in progress, or null
    property real savedElapsed: 0

    signal ready()

    function blankStats() {
        return { easy: { played: 0, won: 0, best: 0 },
                 medium: { played: 0, won: 0, best: 0 },
                 hard: { played: 0, won: 0, best: 0 } }
    }

    function num(v, hi) {
        var n = Math.round(Number(v))
        return isFinite(n) ? Math.max(0, Math.min(hi, n)) : 0
    }

    // FileView.text() is a function in Quickshell; accept a plain property too.
    function readText() {
        try {
            return String(typeof file.text === "function" ? file.text() : file.text)
        } catch (e) { return "" }
    }

    function absorb(raw) {
        var o = null
        try { o = JSON.parse(String(raw || "{}")) } catch (e) { o = null }
        if (!o || typeof o !== "object" || Array.isArray(o)) o = {}
        if (o.level === "easy" || o.level === "medium" || o.level === "hard") level = o.level
        var s = blankStats()
        var names = ["easy", "medium", "hard"]
        for (var i = 0; i < names.length; i++) {
            var src = o.stats && o.stats[names[i]] ? o.stats[names[i]] : {}
            s[names[i]] = { played: num(src.played, 1e6), won: num(src.won, 1e6), best: num(src.best, 1e6) }
        }
        stats = s
        saved = o.current && typeof o.current === "object" ? o.current : null
        savedElapsed = num(o.elapsed, 1e6)
        loaded = true
        ready()
    }

    function played(lvl) {
        var s = JSON.parse(JSON.stringify(stats))
        s[lvl].played += 1
        stats = s
    }

    // Returns true when this is a new best time for the level.
    function won(lvl, seconds) {
        var s = JSON.parse(JSON.stringify(stats)), t = Math.max(1, Math.round(seconds))
        s[lvl].won += 1
        var isBest = s[lvl].best === 0 || t < s[lvl].best
        if (isBest) s[lvl].best = t
        stats = s
        return isBest
    }

    function persist(current, elapsed) {
        file.setText(JSON.stringify({
            version: 1, level: level, stats: stats,
            current: current || null, elapsed: Math.round(elapsed || 0)
        }, null, 2) + "\n")
    }

    Component.onCompleted: prepare.running = true

    Process {
        id: prepare
        command: ["sh", "-c", "mkdir -p \"$1\" && { [ -f \"$2\" ] || printf '{}\\n' > \"$2\"; }", "sh", root.dir, root.path]
        onExited: file.reload()
    }

    FileView {
        id: file
        path: root.path
        watchChanges: false
        onLoaded: root.absorb(root.readText())
    }
}
