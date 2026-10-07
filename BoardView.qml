import QtQuick

// The grid. Pure presentation: Panel.qml owns the game and passes plain arrays.
Item {
    id: root

    property int n: 6
    property real cell: 40
    property var cells: []            // -1 / 0 / 1 per cell
    property var given: []            // bool per cell
    property var wrong: []            // bool per cell (differs from the solution)
    property var broken: []           // bool per cell (breaks a rule)
    property bool showErrors: true
    property int current: 0
    property color fg: "white"
    property string fontFamily: ""
    property real fontSize: 16

    signal cellPressed(int index, int button)

    implicitWidth: n * cell
    implicitHeight: n * cell
    width: implicitWidth
    height: implicitHeight

    function tint(a) { return Qt.rgba(fg.r, fg.g, fg.b, a) }

    Repeater {
        model: root.n * root.n

        delegate: Rectangle {
            id: box
            required property int index

            readonly property int row: Math.floor(index / root.n)
            readonly property int col: index % root.n
            readonly property int curRow: Math.floor(root.current / root.n)
            readonly property int curCol: root.current % root.n
            readonly property int value: root.cells.length > index ? root.cells[index] : -1
            readonly property bool isGiven: root.given.length > index && root.given[index] === true
            readonly property bool isWrong: root.showErrors && root.wrong.length > index && root.wrong[index] === true
            readonly property bool isBroken: root.showErrors && root.broken.length > index && root.broken[index] === true
            readonly property bool isCurrent: index === root.current

            x: col * root.cell
            y: row * root.cell
            width: root.cell
            height: root.cell
            radius: Math.max(2, root.cell * 0.12)
            border.width: isCurrent ? 2 : 1
            border.color: isCurrent ? root.tint(0.95) : root.tint(0.14)
            color: {
                if (isBroken || isWrong) return Qt.rgba(0.92, 0.33, 0.33, 0.20)
                if (isCurrent) return root.tint(0.22)
                if (row === curRow || col === curCol) return root.tint(0.07)
                return isGiven ? root.tint(0.05) : "transparent"
            }

            Text {
                anchors.centerIn: parent
                visible: box.value !== -1
                text: String(box.value)
                textFormat: Text.PlainText
                color: box.isWrong ? Qt.rgba(0.97, 0.45, 0.45, 1) : root.fg
                opacity: box.isGiven ? 1.0 : 0.82
                font.family: root.fontFamily
                font.pixelSize: root.fontSize
                font.bold: box.isGiven
            }
        }
    }

    // One catch-all area instead of n*n small ones.
    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        cursorShape: Qt.PointingHandCursor
        onPressed: function(mouse) {
            var c = Math.floor(mouse.x / root.cell), r = Math.floor(mouse.y / root.cell)
            if (c < 0 || r < 0 || c >= root.n || r >= root.n) return
            root.cellPressed(r * root.n + c, mouse.button)
        }
    }
}
