(function () {
  const A = window.TruchetApp, $ = (id) => document.getElementById(id);
  const set = (id, v) => { const e = $(id); e.value = v; e.dispatchEvent(new Event('input')); };
  set('selFormat', '21:9');
  set('selRes', '4096');
  const c = $('mainCanvas');
  const out = document.createElement('pre');
  out.id = 'shotinfo';
  out.textContent = JSON.stringify({
    frame: A.framePx(), canvasAttr: [c.width, c.height],
    css: [c.style.width, c.style.height], info: ($('frameInfo') || {}).textContent,
    err: ($('err') || {}).textContent
  });
  document.body.appendChild(out);
})();
