/**
 * `?capture=1`: documentation captures on slow software WebGL (CI containers run ~1 FPS).
 * Effects decay 12× slower so a single frame can catch a 0.3 s beam, and the pause banner
 * is hidden because the capture script pauses the match to freeze the moment.
 * Never used at the venue; gameplay timing is untouched (it lives on the server).
 */
export const CAPTURE = new URLSearchParams(window.location.search).has('capture');
export const FX_TIME_SCALE = CAPTURE ? 1 / 12 : 1;
