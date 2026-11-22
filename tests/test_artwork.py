"""Check the finished artwork (requires ffmpeg on PATH)."""
from pathlib import Path
import subprocess
import unittest


class ArtworkTest(unittest.TestCase):
    def test_poster_and_film_keep_face_without_the_hand_on_the_right(self):
        assets = Path(__file__).resolve().parents[1] / 'assets/video'
        for filename in ('gentle-lift-poster.webp', 'gentle-lift.mp4'):
            with self.subTest(asset=filename):
                # One luminance sample per tile, over the entire film. The right
                # fist and forearm are separate from the hand lifting the blindfold.
                pixels = subprocess.check_output([
                    'ffmpeg', '-v', 'error', '-i', str(assets / filename),
                    '-vf', 'scale=32:18:flags=area,format=gray',
                    '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
                ], timeout=30)
                self.assertTrue(pixels)
                frames = [pixels[i:i+576] for i in range(0, len(pixels), 576)]
                for x, y in [(30, 6), (31, 15)]:
                    self.assertLess(max(f[y*32+x] for f in frames), 20)
                self.assertGreater(min(f[4*32+16] for f in frames), 32)
