"""Run python -m unittest discover -s tests with Playwright, Chrome and ffprobe."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import re
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

    def waitlist_page(self, path=''):
        page = self.new_page(viewport={'width': 390, 'height': 780}, reduced_motion='reduce')
        page.goto(self.url + path)
        # Mock responses below are still available offline. An unexpected URL
        # can never transmit an address, including when testing a production build.
        page.context.set_offline(True)
        return page

    def intercept_signup(self, page, endpoint, handler):
        requests = []
        headers = {
            'Access-Control-Allow-Origin': self.url.rstrip('/'),
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }

        def intercept(route):
            request = route.request
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=headers)
                return
            requests.append(request)
            handler(route, headers)

        page.route(lambda url: url == endpoint, intercept)
        return requests

    def test_email_signup_and_keyboard_actions(self):
        address = 'ruth-qa@example.invalid'
        for path in ('', 'v1/', 'v2/', 'v3/'):
            with self.subTest(path=path):
                page = self.waitlist_page(path)
                form = page.locator('#waitlist-form')
                is_live = form.evaluate("form => form.hasAttribute('action')")
                trigger = page.locator('#signup-cta')
                email = page.get_by_role('textbox', name='Email address')
                join = form.locator('button[type="submit"]')
                done = page.get_by_role('button', name='Done', exact=True)
                awaiting_response = []
                if is_live:
                    self.assertEqual(form.evaluate('form => form.method'), 'post')
                    endpoint = form.evaluate('form => form.action')
                    def hold_response(route, headers):
                        awaiting_response.append((route, headers))

                    requests = self.intercept_signup(page, endpoint, hold_response)
                else:
                    requests = []

                    def record_preview_request(request):
                        if (request.resource_type in ('fetch', 'xhr', 'ping') or request.method != 'GET'
                                or request.is_navigation_request()):
                            requests.append(request)

                    page.on('request', record_preview_request)

                trigger.focus()
                page.keyboard.press('Enter')
                expect(email).to_be_focused()
                expect(page.locator('#waitlist-agreement')).to_have_text('By joining, you agree to receive Ruth launch updates by email.')
                expect(page.locator('#waitlist-agreement')).to_be_visible()
                self.assertEqual(form.locator('input:visible').count(), 1)
                if not is_live:
                    self.assertFalse(email.get_attribute('name'))

                page.keyboard.press('Tab')
                expect(join).to_be_focused()
                page.keyboard.press('Enter')
                expect(email).to_be_focused()
                expect(email).to_have_attribute('aria-invalid', 'true')
                expect(page.locator('#waitlist-email-error')).to_be_visible()
                self.assertIn('waitlist-email-error', email.get_attribute('aria-describedby').split())
                email.fill('mistyped')
                page.keyboard.press('Control+Enter')
                expect(page.locator('#waitlist-email-error')).to_contain_text('email')
                self.assertEqual(requests, [])

                email.fill(address)
                if is_live:
                    with page.expect_request(lambda req: req.url == endpoint and req.method == 'POST'):
                        page.keyboard.press('Control+Enter')
                    expect(form).to_have_attribute('aria-busy', 'true')
                    expect(join).to_be_disabled()
                    expect(join).to_have_text('Joining…')
                    # requestSubmit exercises the same path even with the button disabled.
                    form.evaluate('form => { form.requestSubmit(); form.requestSubmit(); }')
                    page.evaluate('new Promise(resolve => requestAnimationFrame(resolve))')
                    self.assertEqual(len(requests), 1)
                    if not path:
                        toggle = page.locator('#ruth-theme-toggle')
                        if toggle.count():
                            theme = page.locator('html').get_attribute('data-ruth-theme')
                            toggle.click()
                            expect(page.locator('html')).not_to_have_attribute('data-ruth-theme', theme)
                            expect(email).to_have_value(address)
                            expect(email).to_be_focused()
                            expect(join).to_be_disabled()
                        page.keyboard.press('Escape')
                        expect(trigger).to_be_focused()
                        page.keyboard.press('Enter')
                        expect(email).to_have_value(address)
                        expect(join).to_be_disabled()
                        page.keyboard.press('Escape')
                        expect(trigger).to_be_focused()
                    self.assertEqual(requests[0].post_data_json, {'email': address, 'consent': True})
                    self.assertEqual(requests[0].headers['content-type'].split(';')[0], 'application/json')
                    route, headers = awaiting_response.pop()
                    route.fulfill(status=200, json={'ok': True}, headers=headers)
                    if not path:
                        # Let the real client process the response while the form is closed.
                        expect(form).to_have_attribute('aria-busy', 'false')
                        expect(trigger).to_be_focused()
                        page.keyboard.press('Enter')
                    expect(page.locator('#waitlist-title')).to_have_text('You’re on the list')
                    expect(page.get_by_role('status')).to_have_text('We’ll email you when Ruth launches.')
                else:
                    page.keyboard.press('Control+Enter')
                    expect(page.get_by_role('status')).to_contain_text('No signup was submitted.')
                    self.assertFalse(requests)

                expect(done).to_be_focused()
                page.keyboard.press('Enter')
                expect(trigger).to_be_focused()
                page.keyboard.press('Enter')
                expect(email).to_have_value('')
                expect(email).to_be_focused()
                page.keyboard.press('Escape')
                expect(trigger).to_be_focused()
                expect(trigger).to_have_attribute('aria-expanded', 'false')
                page.close()

    def test_signup_failure_preserves_address_and_allows_retry(self):
        page = self.waitlist_page()
        form = page.locator('#waitlist-form')
        if not form.evaluate("form => form.hasAttribute('action')"):
            self.skipTest('This release serves the local waitlist preview')
        endpoint = form.evaluate('form => form.action')
        outcomes = iter(('network', 'rate', 'html', 'invalid', 'success'))

        def respond(route, headers):
            outcome = next(outcomes)
            if outcome == 'network':
                route.abort('connectionfailed')
            elif outcome == 'rate':
                route.fulfill(status=429, json={'ok': False, 'error': 'rate_limited'}, headers={**headers, 'Retry-After': '60'})
            elif outcome == 'html':
                route.fulfill(status=200, content_type='text/html', body='<title>Proxy error</title>', headers=headers)
            elif outcome == 'invalid':
                route.fulfill(status=400, json={'ok': False, 'error': 'invalid_email'}, headers=headers)
            else:
                route.fulfill(status=200, json={'ok': True}, headers=headers)

        requests = self.intercept_signup(page, endpoint, respond)
        page.locator('#signup-cta').click()
        email = page.get_by_role('textbox', name='Email address')
        join = form.locator('button[type="submit"]')
        address = 'ruth-retry@example.invalid'
        email.fill(address)
        for attempt, outcome in enumerate(('network', 'rate', 'html', 'invalid'), start=1):
            with self.subTest(outcome=outcome):
                with page.expect_request(lambda req: req.url == endpoint and req.method == 'POST'):
                    join.click()
                if outcome == 'invalid':
                    expect(page.locator('#waitlist-email-error')).to_be_visible()
                    expect(email).to_have_attribute('aria-invalid', 'true')
                    expect(email).to_be_focused()
                else:
                    error = page.locator('#waitlist-request-error')
                    expect(error).to_be_visible()
                    expect(error).to_have_attribute('role', 'alert')
                    self.assertNotEqual(email.get_attribute('aria-invalid'), 'true')
                    expect(error).not_to_have_text('')
                    if outcome == 'rate':
                        expect(error).to_have_text(re.compile(r'wait|later|many|minute|moment', re.IGNORECASE))
                expect(join).to_be_enabled()
                expect(email).to_have_value(address)
                expect(form).to_be_visible()
                self.assertEqual(len(requests), attempt)
        email.fill('ruth-corrected@example.invalid')
        join.click()
        expect(page.get_by_role('status')).to_have_text('We’ll email you when Ruth launches.')
        expect(page.get_by_role('button', name='Done')).to_be_focused()
        self.assertEqual(len(requests), 5)

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
