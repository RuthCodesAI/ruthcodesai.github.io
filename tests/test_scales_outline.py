"""Pixel regression on the real Chromium composite (Pillow, Playwright)."""
import io
import math
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
import unittest

from PIL import Image
from playwright.sync_api import sync_playwright
from test_home import Quiet, ROOT


FRAME = '[data-object="SCALES"] .object-frame'


def missing_outline_pixels(page):
    # Change only the stroke hue on this grayscale page. This preserves its
    # real opacity, width, masks, clipping, occlusion and antialiasing.
    style = page.add_style_tag(content=f'{FRAME} {{ stroke: red !important }}')
    try:
        image = Image.open(io.BytesIO(page.screenshot())).convert('RGB')
    finally:
        style.evaluate('el => el.remove()')
    l,t,r,b = page.locator(FRAME).evaluate('''e => {

        const m=e.getScreenCTM(), box=e.getBBox();
        return [m.e+box.x*m.a,m.f+box.y*m.d,m.e+(box.x+box.width)*m.a,m.f+(box.y+box.height)*m.d];
    }''')
    def red(x,y):
        if not (0 <= x < image.width and 0 <= y < image.height): return False
        a,b,c = image.getpixel((x,y)); return a-max(b,c)>12
    def across(x,y,vertical):
        return any(red(x+d if vertical else x,y if vertical else y+d) for d in (-1,0,1))
    return {
        'top': sum(not across(x,math.floor(t),False) for x in range(math.ceil(l),math.floor(r))),
        'bottom': sum(not across(x,math.floor(b),False) for x in range(math.ceil(l),math.floor(r))),
        'left': sum(not across(math.floor(l),y,True) for y in range(math.ceil(t),math.floor(b))),
        'right': sum(not across(math.floor(r),y,True) for y in range(math.ceil(t),math.floor(b))),
        'corners': sum(not any(red(x+dx,y+dy) for dx in (-1,0,1) for dy in (-1,0,1))
                       for x in map(math.floor,(l,r)) for y in map(math.floor,(t,b))),
    }


class ScalesOutline(unittest.TestCase):
    def test_visible_scale_is_enclosed_by_one_continuous_labeled_outline(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=ROOT))
        Thread(target=server.serve_forever,daemon=True).start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True,channel='chrome')
            for w,h in [(1024,768),(1366,768),(1440,900),(1920,1080)]:
                with self.subTest(size=(w,h)):
                    page=browser.new_page(viewport=dict(width=w,height=h),reduced_motion='reduce')
                    page.goto(f'http://127.0.0.1:{server.server_port}/'); page.evaluate('document.fonts.ready')
                    frame=page.locator(FRAME); frame.wait_for(); self.assertEqual(frame.count(),1)
                    missing=missing_outline_pixels(page)
                    self.assertFalse(any(missing.values()),missing)
                    rect=frame.bounding_box(); label=page.locator('[data-object="SCALES"] text').bounding_box()
                    self.assertLess(label['y']+label['height'],rect['y'])
                    # Near pan's left rim, chain attachment and beam in the reference plate.
                    art=page.locator('.photo').bounding_box()
                    pos=page.locator('.photo').evaluate('e=>getComputedStyle(e).objectPosition.split(" ").map(parseFloat)')
                    k=max(art['width']/958,art['height']/540)
                    for u,v in [(663,537),(733,369),(878,291)]:
                        x=art['x']+(art['width']-958*k)*pos[0]/100+u*k
                        y=art['y']+(art['height']-540*k)*pos[1]/100+v*k
                        if 3<x<w-3 and 3<y<min(h,art['y']+art['height'])-3:
                            self.assertTrue(rect['x'] <= x <= rect['x']+rect['width'] and rect['y'] <= y <= rect['y']+rect['height'], (u,v))
                    page.close()
            browser.close()
