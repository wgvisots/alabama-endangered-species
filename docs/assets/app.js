// Enhancements for the species lists.  Every page reads fine without this file:
// it adds filtering and sorting, marks the current month on the flowering
// strips, and swaps in a note when a photo cannot be loaded.
(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var month = new Date().getMonth() + 1;

  // ---- photos that fail to load ----
  function photoFailed(img) {
    var box = img.closest('[data-photo]');
    if (!box) return;
    box.classList.add('photo-failed');
    var note = box.querySelector('.thumb-fallback, .photo-fallback');
    if (note) note.hidden = false;
  }
  document.querySelectorAll('[data-photo] img').forEach(function (img) {
    if (img.complete && img.naturalWidth === 0) photoFailed(img);
    else img.addEventListener('error', function () { photoFailed(img); });
  });

  // ---- mark this month on every season strip ----
  document.querySelectorAll('.bloom .m[data-m="' + month + '"]').forEach(function (cell) {
    cell.classList.add('now');
  });
  var nowNote = document.getElementById('now-note');
  if (nowNote) nowNote.hidden = false;

  // ---- filters (only on a group page that has them) ----
  var form = document.getElementById('controls');
  var list = document.getElementById('entries');
  if (!form || !list) return;

  var entries = Array.prototype.slice.call(list.children);
  var count = document.getElementById('count');
  var empty = document.getElementById('empty');
  var q = form.elements.q;
  var habitat = form.elements.habitat;
  var county = form.elements.county;
  var sort = form.elements.sort;
  var now = form.elements.now;

  var one = form.dataset.one;
  var many = form.dataset.many;
  document.getElementById('now-label').textContent = form.dataset.now + ' ' + MONTHS[month - 1];
  form.hidden = false;
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  function state() {
    return {
      q: q.value.trim().toLowerCase(),
      status: form.elements.status.value,
      habitat: habitat.value,
      county: county.value,
      sort: sort.value,
      now: now.checked
    };
  }

  function matches(el, s) {
    var d = el.dataset;
    if (s.status && d.status !== s.status) return false;
    if (s.habitat && d.habitat !== s.habitat) return false;
    if (s.county && d.counties.split('|').indexOf(s.county) === -1) return false;
    if (s.now && d.season.split(' ').indexOf(String(month)) === -1) return false;
    if (s.q) {
      var words = s.q.split(/\s+/);
      for (var i = 0; i < words.length; i += 1) {
        if (d.search.indexOf(words[i]) === -1) return false;
      }
    }
    return true;
  }

  function writeUrl(s) {
    var p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.status) p.set('status', s.status);
    if (s.habitat) p.set('habitat', s.habitat);
    if (s.county) p.set('county', s.county);
    if (s.sort !== 'name') p.set('sort', s.sort);
    if (s.now) p.set('now', '1');
    var qs = p.toString();
    try {
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    } catch (e) { /* file:// and sandboxed frames refuse; the filters still work */ }
  }

  function readUrl() {
    var p = new URLSearchParams(location.search);
    function pick(select, value) {
      for (var i = 0; i < select.options.length; i += 1) {
        if (select.options[i].value === value || select.options[i].text === value) {
          select.selectedIndex = i;
          return;
        }
      }
    }
    if (p.get('q')) q.value = p.get('q');
    if (p.get('status') === 'E' || p.get('status') === 'T') form.elements.status.value = p.get('status');
    if (p.get('habitat')) pick(habitat, p.get('habitat'));
    if (p.get('county')) pick(county, p.get('county'));
    if (p.get('sort')) pick(sort, p.get('sort'));
    now.checked = p.get('now') === '1';
  }

  function update() {
    var s = state();
    var shown = 0;

    var ordered = entries.slice().sort(function (a, b) {
      if (s.sort === 'season') {
        var diff = Number(a.dataset.first) - Number(b.dataset.first);
        if (diff) return diff;
      }
      return a.dataset.name < b.dataset.name ? -1 : a.dataset.name > b.dataset.name ? 1 : 0;
    });
    ordered.forEach(function (el) {
      var ok = matches(el, s);
      el.hidden = !ok;
      if (ok) shown += 1;
      list.appendChild(el);
    });

    var noun = entries.length === 1 ? one : many;
    count.textContent = shown === entries.length
      ? entries.length + ' ' + noun
      : shown + ' of ' + entries.length + ' ' + noun;
    empty.hidden = shown !== 0;
    list.hidden = shown === 0;
    writeUrl(s);
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  document.getElementById('clear').addEventListener('click', function () {
    form.reset();
    update();
    q.focus();
  });

  readUrl();
  update();
}());
