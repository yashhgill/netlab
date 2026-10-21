/**
 * HarNova Canvas settings, loaded after the editor.
 * HarNova Canvas is based on draw.io (Apache License 2.0, (c) JGraph Ltd and draw.io AG).
 */
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;
if (window.Editor) {
  Editor.prototype.appName = 'HarNova Canvas';
  Editor.logoImage = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMSIgeTI9IjEiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMyZmIzYTgiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNWI2Y2YwIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0idXJsKCNnKSIvPgogIDxyZWN0IHg9IjExIiB5PSIxMiIgd2lkdGg9IjIwIiBoZWlnaHQ9IjE0IiByeD0iMyIgZmlsbD0iI2ZmZiIvPgogIDxjaXJjbGUgY3g9IjQ1IiBjeT0iNDUiIHI9IjguNSIgZmlsbD0iI2ZmZiIvPgogIDxwYXRoIGQ9Ik0zOCAxMyBMNTAgMjUgTDM4IDM3IEwyNiAyNSBaIiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjU1IiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg0IC0xKSBzY2FsZSgwLjc1KSIvPgogIDxwYXRoIGQ9Ik0yMSAyNiBWNDEgSDMzIiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CiAgPHBhdGggZD0iTTMxIDM2LjUgTDM2LjUgNDEgTDMxIDQ1LjUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9zdmc+Cg==';
}
// the stock title adds " app" when running offline; keep it to the product name
for (const C of [window.EditorUi, window.App]) {
  if (!C || !C.prototype.updateDocumentTitle) continue;
  const update = C.prototype.updateDocumentTitle;
  C.prototype.updateDocumentTitle = function () {
    update.apply(this, arguments);
    document.title = document.title.replace(/ app$/, '');
  };
}

// A small way back to the HarNova Studio launcher.
(function () {
  const add = function () {
    if (document.getElementById('hn-studio')) return;
    const a = document.createElement('a');
    a.id = 'hn-studio';
    a.href = '__TAURI_INTERNALS__' in window ? '../index.html' : '../';
    a.textContent = '\u2190 Studio';
    a.title = 'Back to HarNova Studio';
    a.style.cssText = 'position:fixed;top:12px;right:14px;z-index:9;padding:5px 11px;border-radius:999px;background:#1d2630;color:#fff;font:500 12px system-ui,sans-serif;text-decoration:none;opacity:.85';
    document.body.appendChild(a);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
})();
