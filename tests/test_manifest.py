#!/usr/bin/python3
"""Static checks for the plugin folder: manifest vs QML settings, safety and structure rules."""
import json, os, re, unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def read(name):
    with open(os.path.join(ROOT, name)) as fh:
        return fh.read()


def qml_files():
    return sorted(f for f in os.listdir(ROOT) if f.endswith(".qml"))


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.m = json.loads(read("manifest.json"))
        self.bw = self.m["barWidget"]

    def test_entry_points_exist_and_kinds_agree(self):
        self.assertEqual(self.m["kinds"], ["bar-widget"])
        self.assertEqual(list(self.m["entryPoints"]), ["barWidget"])
        for rel in self.m["entryPoints"].values():
            self.assertTrue(os.path.isfile(os.path.join(ROOT, rel)), rel)

    def test_module_name_matches_plugin_id_everywhere(self):
        for name in ("BarWidget.qml", "Panel.qml"):
            m = re.search(r'moduleName: "([^"]+)"', read(name))
            self.assertIsNotNone(m, name)
            self.assertEqual(m.group(1), self.m["id"], name)

    def test_settings_drift(self):
        used = set(re.findall(r'setting\("([A-Za-z0-9_]+)"', read("Panel.qml") + read("BarWidget.qml")))
        schema = {s["key"] for s in self.bw["schema"]}
        self.assertEqual(used, schema)
        self.assertEqual(set(self.bw["defaults"]), schema)

    def test_defaults_match_schema_and_qml_fallbacks(self):
        qml = read("Panel.qml")
        for s in self.bw["schema"]:
            self.assertEqual(self.bw["defaults"][s["key"]], s["defaultValue"], s["key"])
            m = re.search(r'setting\("%s", ([^)]+)\)' % s["key"], qml)
            self.assertIsNotNone(m, s["key"])
            self.assertEqual(json.loads(m.group(1)), s["defaultValue"], "QML fallback for " + s["key"])
            if s["type"] == "integer":
                self.assertTrue(s["min"] <= s["defaultValue"] <= s["max"])

    def test_integer_ranges_match_qml_clamps(self):
        qml = read("Panel.qml")
        for s in self.bw["schema"]:
            if s["type"] != "integer":
                continue
            m = re.search(r'tkWhole\(setting\("%s", [^)]+\), (\d+), (\d+), (\d+)\)' % s["key"], qml)
            self.assertIsNotNone(m, s["key"])
            self.assertEqual((s["min"], s["max"], s["defaultValue"]), tuple(int(x) for x in m.groups()))

    def test_levels_in_engine_match_tabs(self):
        js = read("Takuzu.js")
        block = re.search(r'var LEVELS = \{(.*?)\n\};', js, re.S).group(1)
        self.assertEqual(re.findall(r'^\s*(\w+):\s*\{', block, re.M), ["easy", "medium", "hard"])


class SafetyAndStructureTests(unittest.TestCase):
    def test_every_text_item_is_plain_text(self):
        """Text.AutoText would render markup and fetch <img src=...> URLs."""
        for name in qml_files():
            lines = read(name).split("\n")
            for i, line in enumerate(lines):
                if not re.match(r"^\s*(?:[\w.]+:\s*)?Text \{\s*$", line):
                    continue
                depth, block = 0, []
                for l in lines[i:]:
                    depth += l.count("{") - l.count("}")
                    block.append(l)
                    if depth <= 0:
                        break
                self.assertTrue(any("textFormat: Text.PlainText" in b for b in block),
                                "%s:%d Text without textFormat: Text.PlainText" % (name, i + 1))

    def test_bar_widget_uses_the_shell_button_not_a_mouse_area(self):
        """The bar does not deliver raw MouseArea input to widgets; WidgetButton is the way in."""
        src = re.sub(r'//[^\n]*', '', read("BarWidget.qml"))
        self.assertNotIn("MouseArea", src)
        self.assertIn("WidgetButton", src)
        self.assertIn("onPressed: function(buttonCode)", src)

    def test_panel_follows_the_shell_contract(self):
        src = read("Panel.qml")
        for needle in ("KeyboardPanel", "focusTarget:", "contentWidth:", "contentHeight:",
                       "manageIpc: false", "function close()", "function open()", "function switchPanel"):
            self.assertIn(needle, src, needle)
        bar = read("BarWidget.qml")
        for needle in ("injectPanel", "closeForPopoutSwitch", "popoutSwitchClosing", "hostWidget"):
            self.assertIn(needle, bar, needle)

    def test_file_text_is_called_as_a_function(self):
        """FileView.text() is a function; passing the bare name stores nothing useful."""
        for name in qml_files():
            self.assertNotRegex(read(name), r'absorb\(text\)', name)

    def test_braces_are_balanced(self):
        for name in qml_files() + ["Takuzu.js"]:
            src = re.sub(r'"(?:\\.|[^"\\])*"', '""', read(name))
            src = re.sub(r"'(?:\\.|[^'\\])*'", "''", src)
            src = re.sub(r'//[^\n]*', '', src)
            for a, b in ("{}", "()", "[]"):
                self.assertEqual(src.count(a), src.count(b), "%s %s%s" % (name, a, b))

    def test_engine_is_a_pragma_library_and_imported_as_such(self):
        self.assertTrue(read("Takuzu.js").lstrip().startswith(".pragma library"))
        self.assertIn('import "Takuzu.js" as Takuzu', read("Panel.qml"))

    def test_no_network_and_only_one_external_command(self):
        for name in qml_files():
            src = read(name)
            for bad in ("XMLHttpRequest", "WebEngine", "fetch("):
                self.assertNotIn(bad, src, name)
        cmds = re.findall(r'command: (\[.*\])\s*$', read("GameStore.qml"), re.M)
        self.assertEqual(len(cmds), 1)
        self.assertTrue(cmds[0].startswith('["sh", "-c", "mkdir -p'))
        for bad in ("curl", "wget", "eval", "ssh"):
            self.assertNotIn(bad, cmds[0])

    def test_state_only_stores_plain_data(self):
        store = read("GameStore.qml")
        self.assertIn("JSON.parse", store)
        self.assertNotIn("eval", store)


if __name__ == "__main__":
    unittest.main(verbosity=2)
