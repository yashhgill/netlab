/**
 * HarNova Canvas settings, loaded before the editor.
 * HarNova Canvas is based on draw.io (Apache License 2.0, (c) JGraph Ltd and draw.io AG).
 */
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null; // PDF export uses the browser's print dialog; PNG, SVG and .drawio export in the browser
window.DRAWIO_BASE_URL = null;
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = {
  // libraries open in the shape panel from the start: general, networking and the big cloud providers
  defaultLibraries: 'general;basic;arrows2;network;cisco19;aws4;gcp2;azure;kubernetes;rack',
  defaultCustomLibraries: [],
};
// Files stay on the user's device: no Google Drive, OneDrive, Dropbox or GitHub sign-ins.
urlParams['offline'] = urlParams['offline'] || '1';
urlParams['sync'] = 'manual';
urlParams['gapi'] = '0';
urlParams['od'] = '0';
urlParams['db'] = '0';
urlParams['gh'] = '0';
urlParams['gl'] = '0';
urlParams['tr'] = '0';
