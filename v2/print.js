import { createLivingVideo } from '../v1/living-video.js';

const plate = document.querySelector('.print-plate');
createLivingVideo({
  root: document.body,
  container: plate,
  photo: plate.querySelector('.portrait'),
});
