"""Run against a served copy: SITE_URL=http://127.0.0.1:8000 python -m unittest discover -s tests

Requires Playwright for Python and its Chromium browser (playwright install chromium).
"""
import os
import re
import unittest

from playwright.sync_api import sync_playwright


class FigureOverlayTest(unittest.TestCase):
    def test_figure_keeps_region_labels_without_pointer_verdicts_or_coordinates(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=os.getenv("BROWSER_CHANNEL"), headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            # Observe text actually painted to the visible canvas, not DOM text:
            # neither the former readouts nor the retained diagram live in HTML.
            page.add_init_script(r"""window.labels = new Set();
                const paint = CanvasRenderingContext2D.prototype.fillText;
                CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
                  if (this.canvas.isConnected && text.length > 1) window.labels.add(text);
                  return paint.call(this, text, ...args);
                };""")
            page.goto(os.environ.get("SITE_URL", "http://127.0.0.1:8000"))
            page.wait_for_function("window.labels.has('A-01')")
            page.evaluate("window.labels.clear()")
            for x, y in [(240, 100), (1160, 190), (260, 630)]:
                page.mouse.move(x, y, steps=12)
            page.wait_for_function("window.labels.has('C-03')")
            labels = page.evaluate("[...window.labels]")
            bad = r"X\s+\d+\s+Y\s+\d+|GO|REVIEW|APPROVED|CLEARED|CONFIRMED"
            self.assertEqual([text for text in labels if re.fullmatch(bad, text)], [])
            browser.close()
