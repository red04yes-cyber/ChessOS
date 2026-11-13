import os
import subprocess
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BASE_URL = "http://127.0.0.1:1420"


class ChessOsBrowserFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        env = os.environ.copy()
        env["CI"] = "1"
        cls.server = subprocess.Popen(
            ["npm", "run", "dev", "--", "--strictPort"],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )

        for _ in range(60):
            if cls.server.poll() is not None:
                error = cls.server.stderr.read() if cls.server.stderr else ""
                raise RuntimeError("Vite si è chiuso prima di avviarsi: " + error[-4000:])
            try:
                with urllib.request.urlopen(BASE_URL, timeout=1):
                    break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(1)
        else:
            cls.server.terminate()
            raise RuntimeError("Timeout durante l'avvio di Vite.")

        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "browser", None):
            cls.browser.close()
        if getattr(cls, "playwright", None):
            cls.playwright.stop()
        if getattr(cls, "server", None) and cls.server.poll() is None:
            cls.server.terminate()
            try:
                cls.server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.server.kill()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.page.goto(BASE_URL, wait_until="domcontentloaded")
        self.page.locator('#chessboard button[data-square="e2"]').wait_for()

    def tearDown(self):
        self.context.close()

    def test_board_accessible_names_and_keyboard_move(self):
        board = self.page.locator("#chessboard button[data-square]")
        self.assertEqual(board.count(), 64)
        self.assertEqual(
            self.page.locator('#chessboard button[data-square="e2"]').get_attribute("aria-label"),
            "Pedone bianco in e2",
        )
        self.assertEqual(
            self.page.locator('#chessboard button[tabindex="0"]').count(),
            1,
            "La scacchiera deve avere un solo punto di ingresso da tastiera.",
        )
        self.assertEqual(self.page.locator("#turn-label").get_attribute("aria-live"), "polite")
        self.assertEqual(self.page.locator("#game-status").get_attribute("aria-live"), "polite")
        self.page.locator('#chessboard button[data-square="e2"]').focus()
        self.page.keyboard.press("Enter")
        self.page.keyboard.press("ArrowUp")
        self.page.keyboard.press("ArrowUp")
        self.page.keyboard.press("Enter")
        self.page.get_by_text("e4", exact=True).wait_for()
        self.assertIn("Nero al tratto", self.page.locator("#turn-label").inner_text())

    def test_pgn_import_and_local_save_survive_reload(self):
        pgn = '[Event "Browser E2E"]\n\n1. e4 e5 2. Nf3 Nc6 *'
        self.page.locator("#pgn-input").fill(pgn)
        self.page.locator("#import-pgn").click()
        self.page.get_by_text("e4", exact=True).wait_for()
        self.page.locator("#line-title").fill("E2E reperto")
        self.page.locator("#save-line").click()
        self.page.locator("#repertoire-list").get_by_text("E2E reperto").wait_for()
        self.page.reload(wait_until="domcontentloaded")
        self.page.locator("#repertoire-list").get_by_text("E2E reperto").wait_for()

    def test_online_import_dialog_has_keyboard_escape_and_accessible_state(self):
        dialog = self.page.locator("#online-import-dialog")
        self.page.locator("#open-online-import").click()
        self.assertFalse(dialog.is_hidden())
        self.assertEqual(dialog.get_attribute("role"), "dialog")
        self.assertEqual(dialog.get_attribute("aria-modal"), "true")
        self.page.keyboard.press("Escape")
        self.page.wait_for_function("document.querySelector('#online-import-dialog').hidden === true")
        self.assertEqual(
            self.page.evaluate("document.activeElement.id"),
            "open-online-import",
            "Il focus deve tornare al controllo che ha aperto il dialogo.",
        )


if __name__ == "__main__":
    unittest.main()
