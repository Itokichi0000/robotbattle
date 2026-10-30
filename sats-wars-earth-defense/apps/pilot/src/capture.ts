/**
 * `?capture=1`: documentation captures (same idea as the big screen's flag). The capture
 * script pauses the match while slow software-WebGL screenshots are taken, so the pause
 * overlay is hidden to keep the phone shots readable and tappable. Never used at the venue;
 * the server still refuses actions while paused.
 */
export const CAPTURE = new URLSearchParams(window.location.search).has('capture');
