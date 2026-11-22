import { createLivingVideo } from '../v1/living-video.js';

const plate = document.querySelector('.print-plate');
const player = createLivingVideo({
  root: document.body,
  container: plate,
  photo: plate.querySelector('.portrait'),
  maxFrameRate: 12,
});

// The lip's rightmost source coordinate over neighboring seconds of the film.
// On particularly tall screens the hand and mouth move through a narrow crop.
const lipRight = [1102, 1146, 1210, 1242, 1247, 1249, 1249, 1249, 1227, 1171, 1120, 1099, 1096, 1096];
const narrow = matchMedia('(max-aspect-ratio: 47/100)');
let cancelTracking;
let visibleWidth;

function positionFrame(video) {
  const t = video.currentTime;
  const second = Math.min(Math.floor(t), lipRight.length - 2);
  const right = lipRight[second] + (lipRight[second + 1] - lipRight[second]) * Math.min(1, t - second);
  const hiddenWidth = 1916 - visibleWidth;
  const left = Math.max(.54 * hiddenWidth, right + 14 - visibleWidth);
  // The fallback poster always retains its opening-frame composition.
  video.style.setProperty('--crop-x', (100 * left / hiddenWidth).toFixed(3) + '%');
}

function sizeFrame() {
  cancelTracking?.();
  cancelTracking = undefined;
  if (!narrow.matches) {
    player.video.style.removeProperty('--crop-x');
    return;
  }
  visibleWidth = 1916 * plate.clientWidth / plate.clientHeight * 924 / 1638;
  positionFrame(player.video);
  cancelTracking = player.onFrame(positionFrame);
}

new ResizeObserver(sizeFrame).observe(plate);
narrow.addEventListener('change', sizeFrame);
sizeFrame();
