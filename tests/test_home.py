"""Run python -m unittest discover -s tests with Playwright, Chrome and ffprobe."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HEADLINE = 'Building the infrastructure for next-generation legal work.'


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
        pw = sync_playwright().start()
        cls.addClassCleanup(pw.stop)
        cls.browser = pw.chromium.launch(channel='chrome', headless=True)
        cls.addClassCleanup(cls.browser.close)
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'

    def new_page(self, **options):
        page = self.browser.new_page(**options)
        self.addCleanup(page.close)
        return page

    def test_layout_keeps_wordmark_below_the_moving_lips(self):
        page = self.new_page(reduced_motion='reduce')
        page.goto(self.url)
        headline = page.get_by_role('heading', level=1, name=HEADLINE, exact=True)
        expect(headline).to_be_visible()
        cta = page.get_by_role('button', name='Join the waitlist')
        for w, h, compact in [(320, 568, True), (350, 349, True), (390, 844, True),
                              (844, 390, True), (768, 1024, True), (961, 651, False),
                              (1280, 800, False), (2560, 900, False)]:
            with self.subTest(viewport=(w, h)):
                page.set_viewport_size({'width': w, 'height': h})
                page.evaluate('document.fonts.ready')
                logo = page.locator('.ruth-home svg').bounding_box()
                title = headline.bounding_box()
                button = cta.bounding_box()
                label = cta.locator('.join-label').bounding_box()
                for box in (logo, title, button):
                    self.assertGreater(box['height'], 0)
                    self.assertGreaterEqual(min(box['x'], box['y']), -0.1)
                    self.assertLessEqual(box['x'] + box['width'], w + 0.1)
                    self.assertLessEqual(box['y'] + box['height'], h + 0.1)
                    self.assertAlmostEqual(box['x'] + box['width'] / 2, w / 2, delta=0.1)
                self.assertLessEqual(logo['y'] + logo['height'], title['y'])
                self.assertLessEqual(title['y'] + title['height'], label['y'])
                if compact:
                    self.assertAlmostEqual(title['y'] + title['height'] / 2, h * .75, delta=.1)
                self.assertGreaterEqual(button['width'], 160)
                self.assertGreaterEqual(button['height'], 46)
                # Every lip position in the original 1916 x 1080 film is above
                # source y=606, including the smiling frame and tracking margin.
                bottom = page.locator('.photo').evaluate('''photo => {
                    const box = photo.getBoundingClientRect(), style = getComputedStyle(photo);
                    if (style.objectFit !== 'cover') throw Error('Expected cover image');
                    const scale = Math.max(box.width / photo.naturalWidth, box.height / photo.naturalHeight);
                    const [, y] = style.objectPosition.split(' ');
                    if (!y.endsWith('%')) throw Error('Expected percentage vertical crop');
                    return box.y + (box.height - photo.naturalHeight * scale) * parseFloat(y) / 100 + 606 * scale;
                }''')
                self.assertGreaterEqual(logo['y'] - bottom, 1)

    def test_original_film_transitions_to_unlabelled_living_ascii(self):
        page = self.new_page(viewport={'width': 800, 'height': 600})
        page.add_init_script('''window.filmFrames = { moving: false, held: false, annotations: [] };
            const context = CanvasRenderingContext2D.prototype;
            const originalText = context.fillText;
            context.fillText = function(label, ...args) {
                if (this.canvas.closest('.art') && String(label).trim().length > 1) {
                    window.filmFrames.annotations.push(label);
                }
                return originalText.call(this, label, ...args);
            };
            const originalRectangle = context.strokeRect;
            context.strokeRect = function(...args) {
                if (this.canvas.closest('.art')) window.filmFrames.annotations.push('rectangle');
                return originalRectangle.apply(this, args);
            };
            document.addEventListener('figureframe', ({detail}) => {
                if (detail.time > 3 && detail.time < 12 && detail.visible > 0 && !detail.held) {
                    window.filmFrames.moving = true;
                }
                if (detail.held) window.filmFrames.held = true;
            }, true);''')
        page.goto(self.url)
        page.wait_for_function("document.querySelector('video')?.ended && window.filmFrames.held", timeout=45_000)
        self.assertTrue(page.evaluate('window.filmFrames.moving'))
        self.assertEqual(page.evaluate('window.filmFrames.annotations'), [])
        shader = page.locator('#shader')
        expect(shader).to_have_attribute('data-material-idle', 'running')
        expect(shader.locator('canvas')).to_be_visible()
        self.assertEqual(page.locator('.art-classes, .object-frame').count(), 0)
        self.assertEqual(page.locator('.art').inner_text().strip(), '')
        expect(page.get_by_role('heading', level=1, name=HEADLINE, exact=True)).to_be_visible()

    def test_email_only_preview_and_keyboard_actions(self):
        page = self.new_page(viewport={'width': 390, 'height': 780}, reduced_motion='reduce')
        page.goto(self.url)
        page.context.set_offline(True)
        trigger = page.get_by_role('button', name='Join the waitlist', exact=True)
        trigger.focus()
        page.keyboard.press('Enter')
        email = page.get_by_role('textbox', name='Email address')
        join = page.get_by_role('button', name='Join', exact=True)
        expect(email).to_be_focused()
        expect(page.locator('#waitlist-panel')).to_be_visible()
        expect(page.locator('#waitlist-agreement')).to_have_text('By joining, you agree to receive Ruth launch updates by email.')
        expect(page.locator('#waitlist-agreement')).to_be_visible()
        self.assertEqual(page.locator('#waitlist-form input').count(), 1)
        self.assertFalse(email.get_attribute('name'))
        page.keyboard.press('Tab')
        expect(join).to_be_focused()
        page.keyboard.press('Enter')
        expect(email).to_be_focused()
        expect(email).to_have_attribute('aria-invalid', 'true')
        expect(page.get_by_role('alert')).to_contain_text('email')
        email.fill('ruth-preview@example.invalid')
        signup_requests = []
        def record_signup_request(request):
            if (request.method != 'GET' or request.resource_type in ('xhr', 'fetch', 'ping')
                    or request.is_navigation_request()):
                signup_requests.append(request.url)
        page.on('request', record_signup_request)
        page.keyboard.press('Control+Enter')
        expect(page.get_by_role('status')).to_contain_text('No signup was submitted.')
        done = page.get_by_role('button', name='Done')
        expect(done).to_be_focused()
        page.keyboard.press('Enter')
        expect(trigger).to_be_focused()
        page.keyboard.press('Enter')
        expect(email).to_have_value('')
        page.keyboard.press('Escape')
        expect(trigger).to_be_focused()
        expect(trigger).to_have_attribute('aria-expanded', 'false')
        self.assertFalse(signup_requests)

    def test_content_does_not_wait_for_palette_script(self):
        page = self.new_page()
        pending = []
        page.route('**/palette.js*', lambda route: pending.append(route))
        page.goto(self.url + '?palette=marble', wait_until='commit')
        try:
            expect(page.get_by_role('heading', level=1, name=HEADLINE, exact=True)).to_be_visible(timeout=3000)
        finally:
            for route in pending:
                route.continue_()
        expect(page.locator('html')).to_have_attribute('data-palette', 'marble')

    def test_tab_icon_needs_no_extra_request(self):
        page = self.new_page()
        page.goto(self.url)
        self.assertTrue(page.evaluate("document.querySelector('link[rel~=icon]')?.href.startsWith('data:image/svg+xml')"))
