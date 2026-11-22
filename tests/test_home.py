"""Run: python -m unittest discover -s tests (requires Playwright and Chrome)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Home(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=ROOT))
        Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)
        cls.pw = sync_playwright().start()
        cls.addClassCleanup(cls.pw.stop)
        cls.browser = cls.pw.chromium.launch(channel='chrome', headless=True)
        cls.addClassCleanup(cls.browser.close)
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'

    def test_animated_hero_paints_without_tracking_boxes_or_labels(self):
        p = self.browser.new_page(viewport={'width':1440,'height':900})
        self.addCleanup(p.close)
        # Canvas annotations are not DOM text. Observe the painted hero from
        # the first frame through the film and the subsequent animated grid.
        p.add_init_script(r"""window.marks = {rectangles: 0, labels: []};
            const ctx = CanvasRenderingContext2D.prototype;
            const stroke = ctx.strokeRect, text = ctx.fillText;
            ctx.strokeRect = function(...args) {
                if (this.canvas.closest('.art')) marks.rectangles++;
                return stroke.apply(this, args);
            };
            ctx.fillText = function(value, ...args) {
                if (this.canvas.closest('.art') && /^(?:[ABC]-0[123]|X\s+\d+\s+Y\s+\d+|GO|REVIEW|APPROVED|CLEARED|CONFIRMED)$/.test(value)
                    && !marks.labels.includes(value)) marks.labels.push(value);
                return text.call(this, value, ...args);
            };""")
        p.goto(self.url)
        p.wait_for_function("document.querySelector('video')?.currentTime > 6")
        p.mouse.move(1160,190,steps=12)
        p.wait_for_function("document.querySelector('video')?.ended && document.querySelector('#shader.ready canvas')")
        self.assertEqual(p.evaluate('window.marks'), {'rectangles':0, 'labels':[]})

    def test_wordmark_leads_unchanged_tagline(self):
        for w,h,old_size in [(390,844,46.02),(1440,900,112.27),(844,390,56.55)]:
            with self.subTest(viewport=(w,h)):
                p = self.browser.new_page(viewport={'width':w,'height':h})
                self.addCleanup(p.close)
                p.goto(self.url+'?preview')
                title = p.get_by_role('heading',level=1)
                self.assertEqual(title.inner_text(), 'Building the infrastructure for next-generation legal work.')
                size = title.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)')
                logo = p.locator('.ruth-home svg').bounding_box()
                self.assertGreater(logo['height'], 2*size)
                self.assertLess(size, old_size)
                self.assertGreaterEqual(size,18)
                self.assertLess(logo['y']+logo['height'],title.bounding_box()['y'])
                p.close()

    def test_waitlist_button(self):
        for w,h in [(320,568),(390,844),(844,390),(1440,900)]:
            with self.subTest(viewport=(w,h)):
                p = self.browser.new_page(viewport={'width':w,'height':h}, reduced_motion='reduce')
                self.addCleanup(p.close)
                p.goto(self.url)
                btn = p.get_by_role('button', name='Join the waitlist', exact=True)
                box = btn.bounding_box()
                self.assertGreaterEqual(box['height'],44)
                self.assertGreaterEqual(box['width'],44)
                self.assertGreaterEqual(box['y'],0)
                self.assertLessEqual(box['y']+box['height'],h)
                self.assertEqual(btn.evaluate('e=>getComputedStyle(e).backgroundColor'), 'rgb(0, 0, 0)')
                self.assertEqual(btn.evaluate('e=>getComputedStyle(e).color'), 'rgb(242, 240, 235)')
                self.assertEqual(btn.evaluate('e=>getComputedStyle(e).borderRadius'), '0px')
                heading = p.get_by_role('heading',level=1).bounding_box()
                center = box['x']+box['width']/2
                self.assertAlmostEqual(center, heading['x']+heading['width']/2,delta=1)
                self.assertAlmostEqual(center, w/2,delta=1)
                self.assertGreaterEqual(box['y'],heading['y']+heading['height'])
                for _ in range(3):
                    p.keyboard.press('Tab')
                self.assertTrue(btn.evaluate("e=>e.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none'"))
                p.keyboard.press('Enter')
                self.assertTrue(p.get_by_role('textbox',name='Email address').evaluate('e=>document.activeElement===e'))
                p.keyboard.press('Escape')
                self.assertTrue(btn.evaluate('e=>document.activeElement===e'))
                p.close()

    def test_content_does_not_wait_for_palette_script(self):
        p = self.browser.new_page()
        self.addCleanup(p.close)
        pending = []
        p.route('**/palette.js', lambda route: pending.append(route))
        p.goto(self.url+'?palette=marble',wait_until='commit')
        try:
            p.get_by_role('heading',level=1).wait_for(state='visible',timeout=1500)
        finally:
            for route in pending:
                route.continue_()
        p.wait_for_load_state('load')
        self.assertEqual(p.locator('html').get_attribute('data-palette'), 'marble')

    def test_tab_icon_needs_no_extra_request(self):
        p = self.browser.new_page()
        self.addCleanup(p.close)
        p.goto(self.url)
        self.assertTrue(p.evaluate("document.querySelector('link[rel~=icon]')?.href.startsWith('data:image/svg+xml')"))

    def test_initial_font_budget(self):
        p = self.browser.new_page()
        self.addCleanup(p.close)
        p.goto(self.url)
        p.evaluate('document.fonts.ready')
        sizes = p.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.woff2')).map(e=>e.encodedBodySize)")
        self.assertTrue(sizes)
        self.assertLess(sum(sizes), 65_000)
