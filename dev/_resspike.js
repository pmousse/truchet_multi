/* Full sweep of the control that used to black the stage: every tab, every
 * frame format, every long-edge preset. A zero-height canvas is reported, not
 * crashed on, so a regression shows up as a row rather than an exception. */
window.SPIKE = function () {
  const A = window.TruchetApp;
  const $ = (id) => document.getElementById(id);
  const set = (id, v) => {
    const e = $(id);
    if (!e) throw new Error('no element #' + id);
    e.value = v; e.dispatchEvent(new Event('input'));
    if (e.value !== v) throw new Error('#' + id + ' rejected ' + v);
  };
  const raw = (v) => Array.isArray(v) ? v.map(x => typeof x + ':' + String(x)).join(',') : typeof v + ':' + String(v);
  const rows = [], problems = [];
  window.addEventListener('error', (e) => problems.push(e.message));

  for (const tab of ['gen', 'photo', 'fill']) {
    for (const fmt of ['1:1', '16:9', '9:16', '21:9', 'custom']) {
      for (const res of ['1024', '2048', '2560', '3840', '4096']) {
        const r = { tab, fmt, res };
        try {
          A.setTab(tab);
          set('selFormat', fmt);
          if (fmt === 'custom') { set('inFrameW', '1600'); set('inFrameH', '1000'); }
          set('selRes', res);
          const c = $('mainCanvas');
          r.resState = raw(A.state().res);
          r.framePx = raw(A.framePx());
          r.canvasAttr = [c.width, c.height];
          r.canvasStyle = c.style.width + ' x ' + c.style.height;
          if (c.width && c.height) {
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let dark = 0, light = 0, clear = 0, n = 0;
            for (let i = 0; i < d.length; i += 4 * 89) {
              const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
              n++; if (d[i + 3] === 0) clear++;
              if (l < 40) dark++; else if (l > 200) light++;
            }
            r.verdict = (clear === n) ? 'TRANSPARENT' : (dark === n ? 'ALL BLACK' : (light === 0 ? 'NO LIGHT' : 'ok'));
          } else r.verdict = 'CANVAS ZERO-SIZED';
          r.err = (($('err') || {}).textContent || '').slice(0, 40);
        } catch (e) { r.step_failed = String(e && e.message || e); }
        rows.push(r);
      }
    }
  }
  return { rows, problems };
};
