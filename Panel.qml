import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "Takuzu.js" as Takuzu

// The Takuzu popup. Everything the bar widget needs to know (label, open state)
// is exposed here; the puzzle logic itself lives in Takuzu.js and is unit-tested.
//
// Keys:  arrows move   0 / 1 place   Space cycle   E / Backspace erase
//        H hint   U / Ctrl+Z undo   D difficulty   R new puzzle   Esc close
Panel {
    id: root
    moduleName: "io.github.qempexe.omatakuzu"
    manageIpc: false

    property var anchorItem: null
    property var hostWidget: null

    // ---- settings (declared in manifest.json) ----------------------------------------
    readonly property bool showCounts: tkFlag(setting("showCounts", true), true)
    readonly property bool highlightErrors: tkFlag(setting("highlightErrors", true), true)
    readonly property int mistakeLimit: tkWhole(setting("mistakeLimit", 0), 0, 9, 0)
    readonly property bool barTime: tkFlag(setting("barTime", true), true)

    function tkFlag(value, fallback) {
        if (value === true || value === "true") return true
        if (value === false || value === "false") return false
        return fallback
    }

    function tkWhole(value, lo, hi, fallback) {
        var v = Number(value)
        if (!isFinite(v)) return fallback
        return Math.max(lo, Math.min(hi, Math.round(v)))
    }

    // ---- game state ----------------------------------------------------------------------
    property bool tkReady: false
    property string tkLevel: "easy"
    property var tkGame: null              // Takuzu state, mutated in place
    property int tkRev: 0                  // bump after every in-place change
    property int tkCur: 0
    property real tkElapsed: 0
    property double tkLastTick: 0
    property int tkCounter: 0
    property bool tkEndHandled: false
    property bool tkConfirmNew: false
    property string tkConfirmLevel: ""
    property string tkNotice: ""

    function tkTouch() { tkRev += 1 }

    readonly property bool tkLost: {
        tkRev
        return tkGame !== null && mistakeLimit > 0 && tkGame.mistakes >= mistakeLimit
    }
    readonly property bool tkFinished: {
        tkRev
        return tkGame !== null && (tkGame.won || tkLost)
    }
    readonly property bool tkTiming: {
        tkRev
        return tkGame !== null && tkGame.moves > 0 && !tkFinished
    }

    readonly property int tkN: { tkRev; return tkGame ? tkGame.n : 6 }
    readonly property real tkCell: Math.floor(Style.space(300) / tkN)

    readonly property var tkCells: { tkRev; return tkGame ? tkGame.cells.slice() : [] }
    readonly property var tkGiven: tkGame ? tkGame.given : []
    readonly property var tkWrong: {
        tkRev
        var out = []
        if (!tkGame) return out
        for (var i = 0; i < tkGame.cells.length; i++)
            out.push(!tkGame.given[i] && tkGame.cells[i] !== -1 && tkGame.cells[i] !== tkGame.solution[i])
        return out
    }
    readonly property var tkBroken: { tkRev; return tkGame ? Takuzu.conflicts(tkGame.cells, tkGame.n) : [] }

    readonly property string barText: {
        tkRev
        if (!tkGame || tkGame.moves === 0 || !barTime) return "01"
        return "01 " + Takuzu.formatTime(tkElapsed)
    }

    readonly property string tkLineInfo: {
        tkRev
        if (!tkGame) return ""
        var n = tkGame.n, half = n / 2
        var r = Math.floor(tkCur / n), c = tkCur % n
        function need(label, vals) {
            var z = 0, o = 0
            for (var i = 0; i < vals.length; i++) { if (vals[i] === 0) z++; else if (vals[i] === 1) o++ }
            var mz = half - z, mo = half - o
            if (mz === 0 && mo === 0) return label + " done"
            if (mz < 0 || mo < 0) return label + " has too many"
            return label + " needs " + mz + "\u00d70 and " + mo + "\u00d71"
        }
        var row = [], col = []
        for (var i = 0; i < n; i++) { row.push(tkGame.cells[r * n + i]); col.push(tkGame.cells[i * n + c]) }
        return need("Row " + (r + 1), row) + "  \u00b7  " + need("Col " + (c + 1), col)
    }

    readonly property string tkStatLine: {
        tkRev
        var s = store.stats[tkLevel]
        return "Best " + (s.best > 0 ? Takuzu.formatTime(s.best) : "--:--") + "  \u00b7  solved " + s.won + "/" + s.played
    }

    function tkFirstFree() {
        if (!tkGame) return 0
        for (var i = 0; i < tkGame.given.length; i++) if (!tkGame.given[i]) return i
        return 0
    }

    function tkTick() {
        var now = Date.now()
        tkElapsed += Math.max(0, now - tkLastTick) / 1000
        tkLastTick = now
    }

    function tkStartNew(lvl) {
        tkLevel = lvl
        store.level = lvl
        tkCounter += 1
        var seed = ((Date.now() % 2147483647) ^ (tkCounter * 2654435761)) >>> 0
        tkGame = Takuzu.newState(Takuzu.generate(lvl, seed))
        tkElapsed = 0
        tkLastTick = Date.now()
        tkEndHandled = false
        tkConfirmNew = false
        tkNotice = ""
        tkCur = tkFirstFree()
        tkTouch()
        tkSaveNow()
    }

    function tkInit() {
        if (tkReady) return
        tkReady = true
        tkLevel = store.level
        var st = store.saved ? Takuzu.decodeState(store.saved) : null
        if (st && !st.won) {
            tkGame = st
            tkLevel = st.level
            tkElapsed = store.savedElapsed
            tkLastTick = Date.now()
            tkCur = tkFirstFree()
            tkTouch()
        } else {
            tkStartNew(tkLevel)
        }
    }

    function tkSaveNow() {
        if (!tkReady || !tkGame) return
        store.persist(tkFinished ? null : Takuzu.encodeState(tkGame), tkElapsed)
    }

    // ---- input ------------------------------------------------------------------------------
    function tkMove(dr, dc) {
        if (!tkGame) return
        var n = tkGame.n
        var r = Math.max(0, Math.min(n - 1, Math.floor(tkCur / n) + dr))
        var c = Math.max(0, Math.min(n - 1, tkCur % n + dc))
        tkCur = r * n + c
    }

    function tkAfter(r) {
        if (!r.changed) return
        if (tkGame.moves === 1) { store.played(tkLevel); tkLastTick = Date.now() }
        if (r.mistake) tkNotice = "Mistake"
        tkTouch()
        tkCheckEnd()
        tkSaveSoon.restart()
    }

    function tkCheckEnd() {
        if (tkEndHandled || !tkGame) return
        if (tkGame.won) {
            tkEndHandled = true
            tkTick()
            var best = store.won(tkLevel, tkElapsed)
            tkNotice = "Solved in " + Takuzu.formatTime(tkElapsed) + (best ? " \u2014 new best!" : "")
            tkTouch()
            tkSaveNow()
        } else if (tkLost) {
            tkEndHandled = true
            tkNotice = "Too many mistakes. Press R for a new puzzle."
            tkSaveNow()
        }
    }

    function tkPlace(v) {
        if (!tkGame || tkFinished) return
        tkAfter(Takuzu.setCell(tkGame, tkCur, v))
    }

    function tkCycle() {
        if (!tkGame || tkFinished) return
        tkAfter(Takuzu.cycleCell(tkGame, tkCur))
    }

    function tkUndo() {
        if (!tkGame || tkFinished) return
        if (Takuzu.undo(tkGame)) { tkTouch(); tkSaveSoon.restart() }
    }

    function tkHint() {
        if (!tkGame || tkFinished) return
        var h = Takuzu.applyHint(tkGame)
        if (!h) return
        tkCur = h.idx
        tkNotice = "Hint: " + h.reason
        tkAfter({ changed: true, mistake: false })
    }

    function tkRequestNew(lvl) {
        if (tkGame && tkGame.moves > 0 && !tkFinished && !(tkConfirmNew && tkConfirmLevel === lvl)) {
            tkConfirmNew = true
            tkConfirmLevel = lvl
            tkNotice = "Press again to abandon this puzzle"
            confirmTimer.restart()
            return
        }
        tkStartNew(lvl)
    }

    function tkNextLevel() {
        var names = Takuzu.levelNames()
        tkRequestNew(names[(names.indexOf(tkLevel) + 1) % names.length])
    }

    function tkKey(event) {
        var k = event.key, used = true
        if (k === Qt.Key_Escape) root.close()
        else if (k === Qt.Key_Tab) root.switchPanel(1)
        else if (k === Qt.Key_Backtab) root.switchPanel(-1)
        else if (k === Qt.Key_Left) tkMove(0, -1)
        else if (k === Qt.Key_Right) tkMove(0, 1)
        else if (k === Qt.Key_Up) tkMove(-1, 0)
        else if (k === Qt.Key_Down) tkMove(1, 0)
        else if (k === Qt.Key_0) tkPlace(0)
        else if (k === Qt.Key_1) tkPlace(1)
        else if (k === Qt.Key_Space || k === Qt.Key_Return || k === Qt.Key_Enter) tkCycle()
        else if (k === Qt.Key_Backspace || k === Qt.Key_Delete || k === Qt.Key_E) tkPlace(-1)
        else if (k === Qt.Key_H) tkHint()
        else if (k === Qt.Key_U || (k === Qt.Key_Z && (event.modifiers & Qt.ControlModifier))) tkUndo()
        else if (k === Qt.Key_D) tkNextLevel()
        else if (k === Qt.Key_R || k === Qt.Key_N) tkRequestNew(tkLevel)
        else used = false
        event.accepted = used
    }

    // ---- shell plumbing (same shape as the official clock example) ------------------------------
    function open() { root.controller.show() }
    function close() { root.controller.hide() }

    function switchPanel(direction) {
        if (root.bar && typeof root.bar.switchPanelFrom === "function")
            return root.bar.switchPanelFrom(root.hostWidget || root, direction)
        return false
    }

    onOpenedChanged: {
        if (opened) {
            tkLastTick = Date.now()
            tkConfirmNew = false
        } else if (tkReady) {
            tkTick()
            tkSaveNow()
        }
    }

    GameStore {
        id: store
        onReady: root.tkInit()
    }

    Component.onCompleted: if (store.loaded) tkInit()

    // If the state file cannot be read, still give the player a puzzle.
    Timer { interval: 1500; running: !root.tkReady; onTriggered: root.tkInit() }

    Timer {
        interval: 250
        repeat: true
        running: root.opened && root.tkTiming
        onTriggered: root.tkTick()
    }

    Timer { id: tkSaveSoon; interval: 600; onTriggered: root.tkSaveNow() }
    Timer { id: confirmTimer; interval: 2500; onTriggered: { root.tkConfirmNew = false; root.tkNotice = "" } }

    // ---- small reusable button ------------------------------------------------------------------
    component PadButton: Rectangle {
        id: btn
        property string label: ""
        property bool active: false
        property color fg: "white"
        property string fontFamily: ""
        property real fontSize: 12
        signal clicked()

        implicitWidth: lbl.implicitWidth + Style.space(18)
        implicitHeight: Style.space(26)
        radius: height / 2
        color: active ? Qt.rgba(fg.r, fg.g, fg.b, 0.20)
                      : (area.containsMouse ? Qt.rgba(fg.r, fg.g, fg.b, 0.12) : "transparent")
        border.width: active ? 1 : 0
        border.color: Qt.rgba(fg.r, fg.g, fg.b, 0.55)

        Text {
            id: lbl
            anchors.centerIn: parent
            text: btn.label
            textFormat: Text.PlainText
            color: btn.fg
            opacity: btn.active ? 1.0 : 0.8
            font.family: btn.fontFamily
            font.pixelSize: btn.fontSize
            font.bold: btn.active
        }

        MouseArea {
            id: area
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: btn.clicked()
        }
    }

    KeyboardPanel {
        id: panel
        anchorItem: root.anchorItem
        owner: root.hostWidget || root
        bar: root.bar
        open: root.opened
        focusTarget: keys
        contentWidth: panel.fittedContentWidth(Style.space(316))
        contentHeight: panel.fittedContentHeight(content.implicitHeight)

        // Our own key handler: this game needs every key, not just navigation.
        FocusScope {
            id: keys
            anchors.fill: parent
            Keys.onPressed: function(event) { root.tkKey(event) }

            Column {
                id: content
                width: parent.width
                spacing: Style.space(10)

                // TIME / MISTAKES / HINTS
                Row {
                    spacing: Style.space(22)
                    Repeater {
                        model: [
                            { k: "TIME", v: root.tkGame ? Takuzu.formatTime(root.tkElapsed) : "00:00" },
                            { k: "MISTAKES", v: root.tkGame ? String(root.tkGame.mistakes) + (root.mistakeLimit > 0 ? "/" + root.mistakeLimit : "") : "0" },
                            { k: "HINTS", v: root.tkGame ? String(root.tkGame.hints) : "0" }
                        ]
                        delegate: Column {
                            required property var modelData
                            spacing: Style.space(1)
                            Text {
                                text: parent.modelData.k
                                textFormat: Text.PlainText
                                color: root.barForeground
                                opacity: 0.6
                                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                font.pixelSize: Style.font.caption
                            }
                            Text {
                                text: parent.modelData.v
                                textFormat: Text.PlainText
                                color: parent.modelData.k === "MISTAKES" && root.tkGame && root.tkGame.mistakes > 0
                                    ? Qt.rgba(0.97, 0.45, 0.45, 1) : root.barForeground
                                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                font.pixelSize: Style.font.subtitle
                                font.bold: true
                            }
                        }
                    }
                }

                // difficulty tabs
                Row {
                    spacing: Style.space(6)
                    anchors.horizontalCenter: parent.horizontalCenter
                    Repeater {
                        model: Takuzu.levelNames()
                        delegate: PadButton {
                            required property string modelData
                            label: Takuzu.LEVELS[modelData].label
                            active: root.tkLevel === modelData
                            fg: root.barForeground
                            fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                            fontSize: Style.font.bodySmall
                            onClicked: root.tkRequestNew(modelData)
                        }
                    }
                    PadButton {
                        label: "NEW"
                        fg: root.barForeground
                        fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                        fontSize: Style.font.bodySmall
                        onClicked: root.tkRequestNew(root.tkLevel)
                    }
                }

                BoardView {
                    anchors.horizontalCenter: parent.horizontalCenter
                    n: root.tkN
                    cell: root.tkCell
                    cells: root.tkCells
                    given: root.tkGiven
                    wrong: root.tkWrong
                    broken: root.tkBroken
                    showErrors: root.highlightErrors
                    current: root.tkCur
                    fg: root.barForeground
                    fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                    fontSize: Math.round(root.tkCell * 0.46)
                    onCellPressed: function(index, button) {
                        root.tkCur = index
                        if (button === Qt.RightButton) root.tkPlace(-1)
                        else root.tkCycle()
                    }
                }

                // hint reason / confirmation / row and column needs
                Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    textFormat: Text.PlainText
                    text: root.tkNotice !== "" ? root.tkNotice : (root.showCounts ? root.tkLineInfo : "")
                    color: root.barForeground
                    opacity: root.tkFinished ? 1.0 : 0.75
                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                    font.pixelSize: Style.font.bodySmall
                    font.bold: root.tkFinished
                }

                Row {
                    spacing: Style.space(6)
                    anchors.horizontalCenter: parent.horizontalCenter
                    Repeater {
                        model: [
                            { l: "0", f: "p0" }, { l: "1", f: "p1" }, { l: "erase", f: "er" },
                            { l: "undo", f: "un" }, { l: "hint", f: "hi" }
                        ]
                        delegate: PadButton {
                            required property var modelData
                            label: modelData.l
                            fg: root.barForeground
                            fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                            fontSize: Style.font.body
                            onClicked: {
                                if (modelData.f === "p0") root.tkPlace(0)
                                else if (modelData.f === "p1") root.tkPlace(1)
                                else if (modelData.f === "er") root.tkPlace(-1)
                                else if (modelData.f === "un") root.tkUndo()
                                else root.tkHint()
                            }
                        }
                    }
                }

                Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    textFormat: Text.PlainText
                    text: root.tkStatLine
                    color: root.barForeground
                    opacity: 0.6
                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                    font.pixelSize: Style.font.caption
                }

                Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                    textFormat: Text.PlainText
                    text: "Arrows move \u00b7 0/1 place \u00b7 Space cycle \u00b7 E erase\nH hint \u00b7 U undo \u00b7 D difficulty \u00b7 R new game"
                    color: root.barForeground
                    opacity: 0.5
                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                    font.pixelSize: Style.font.caption
                }
            }
        }
    }
}
