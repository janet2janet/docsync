/* =========================================================
   DocSync — Side-by-Side Translation App
   ========================================================= */

'use strict';

// ── PDF.js worker ──────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── State ─────────────────────────────────────────────────
const state = {
  en: { doc: null, page: 1, total: 0, scale: 1.2 },
  ko: { doc: null, page: 1, total: 0, scale: 1.2 },
  flashcards: loadCards(),
  view: 'pdf',           // 'pdf' | 'parallel'
  fcOpen: false,
  dictOpen: false,
  studyMode: false,
  studyIndex: 0,
  studyFlipped: false,
  selText: '',
  selLang: '',
  selX: 0,
  selY: 0,
};

// ── DOM refs ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  pdfView:    $('pdf-view'),
  parallelView: $('parallel-view'),
  parallelBody: $('parallel-body'),
  parPlaceholder: $('par-placeholder'),
  // PDF panels
  panelEn: $('panel-en'), panelKo: $('panel-ko'),
  dropEn: $('drop-en'),   dropKo: $('drop-ko'),
  viewerEn: $('viewer-en'), viewerKo: $('viewer-ko'),
  uploadEn: $('upload-en'), uploadKo: $('upload-ko'),
  controlsEn: $('controls-en'), controlsKo: $('controls-ko'),
  prevEn: $('prev-en'), nextEn: $('next-en'), pageInfoEn: $('page-info-en'),
  prevKo: $('prev-ko'), nextKo: $('next-ko'), pageInfoKo: $('page-info-ko'),
  zoomInEn: $('zoom-in-en'), zoomOutEn: $('zoom-out-en'), zoomLabelEn: $('zoom-label-en'),
  zoomInKo: $('zoom-in-ko'), zoomOutKo: $('zoom-out-ko'), zoomLabelKo: $('zoom-label-ko'),
  // Selection bar
  selBar: $('sel-bar'),
  // Card modal
  cardOverlay: $('card-overlay'), cardModal: $('card-modal'),
  cardFront: $('card-front'), cardBack: $('card-back'), cardNotes: $('card-notes'),
  // Flashcard panel
  fcPanel: $('flashcard-panel'),
  fcList: $('fc-list'), fcEmpty: $('fc-empty'),
  fcCount: $('flashcard-count'),
  fcListView: $('fc-list-view'), fcStudyView: $('fc-study-view'),
  studyCard: $('study-card'), studyInner: $('study-card-inner'),
  studyFront: $('study-front-text'), studyBack: $('study-back-text'),
  studyNotes: $('study-notes-text'), studyCounter: $('study-counter'),
  // Dictionary sidebar
  dictSidebar: $('dict-sidebar'), dictBody: $('dict-body'),
  // Settings
  settingsOverlay: $('settings-overlay'), settingsModal: $('settings-modal'),
  // Print
  printSheet: $('print-sheet'), printCards: $('print-cards'), printDate: $('print-date'),
  // Toast / view btns
  toast: $('toast'),
  btnPdfView: $('btn-pdf-view'), btnParallelView: $('btn-parallel-view'),
};

// ── Persistence ───────────────────────────────────────────
function loadCards() {
  try { return JSON.parse(localStorage.getItem('docsync_cards') || '[]'); }
  catch { return []; }
}
function saveCards() {
  localStorage.setItem('docsync_cards', JSON.stringify(state.flashcards));
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2400);
}

// ── Utility ───────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// =========================================================
// PDF Loading & Rendering
// =========================================================

async function loadPDF(file, lang) {
  const s       = lang === 'en' ? state.en : state.ko;
  const viewer  = lang === 'en' ? dom.viewerEn  : dom.viewerKo;
  const drop    = lang === 'en' ? dom.dropEn    : dom.dropKo;
  const ctrls   = lang === 'en' ? dom.controlsEn : dom.controlsKo;

  drop.querySelector('.drop-prompt').hidden = true;
  viewer.hidden = false;
  viewer.innerHTML = `<div class="pdf-loading"><div class="spinner"></div><span>Loading PDF…</span></div>`;

  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    s.doc = pdf; s.total = pdf.numPages; s.page = 1;
    ctrls.hidden = false;
    await renderAllPages(lang);
    updatePageInfo(lang);
    showToast(`Loaded ${pdf.numPages} page${pdf.numPages !== 1 ? 's' : ''}`);
  } catch (err) {
    viewer.innerHTML = `<div class="pdf-loading" style="color:#ff6060">Failed to load PDF.<br><small>${escHtml(err.message)}</small></div>`;
    console.error(err);
  }
}

async function renderAllPages(lang) {
  const s = lang === 'en' ? state.en : state.ko;
  if (!s.doc) return;
  const viewer = lang === 'en' ? dom.viewerEn : dom.viewerKo;
  viewer.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-pages-wrapper';
  viewer.appendChild(wrapper);
  for (let i = 1; i <= s.total; i++) {
    wrapper.appendChild(await renderPage(s.doc, i, s.scale, lang));
  }
}

async function renderPage(doc, pageNum, scale, lang) {
  const page     = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const container = document.createElement('div');
  container.className = 'pdf-page-container';
  container.dataset.page = pageNum;
  container.dataset.lang = lang;
  container.style.width  = viewport.width  + 'px';
  container.style.height = viewport.height + 'px';

  const lbl = document.createElement('div');
  lbl.className = 'page-label';
  lbl.textContent = `Page ${pageNum}`;
  container.appendChild(lbl);

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  container.appendChild(canvas);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  // Text layer for selection
  const textContent = await page.getTextContent();
  const textLayer   = document.createElement('div');
  textLayer.className = 'textLayer';
  container.appendChild(textLayer);
  pdfjsLib.renderTextLayer({
    textContentSource: textContent,
    container: textLayer,
    viewport,
    textDivs: [],
  });

  return container;
}

// ── Page controls ─────────────────────────────────────────
function updatePageInfo(lang) {
  const s    = lang === 'en' ? state.en : state.ko;
  const info = lang === 'en' ? dom.pageInfoEn : dom.pageInfoKo;
  const prev = lang === 'en' ? dom.prevEn : dom.prevKo;
  const next = lang === 'en' ? dom.nextEn : dom.nextKo;
  info.textContent = `${s.page} / ${s.total}`;
  prev.disabled = s.page <= 1;
  next.disabled = s.page >= s.total;
}

function goPage(lang, delta) {
  const s = lang === 'en' ? state.en : state.ko;
  const n = s.page + delta;
  if (n < 1 || n > s.total) return;
  const viewer = lang === 'en' ? dom.viewerEn : dom.viewerKo;
  const target = viewer.querySelector(`[data-page="${n}"]`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  s.page = n;
  updatePageInfo(lang);
}

function setupPageTracker(lang) {
  const viewer = lang === 'en' ? dom.viewerEn : dom.viewerKo;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const p = parseInt(e.target.dataset.page, 10);
        if (!isNaN(p)) { (lang === 'en' ? state.en : state.ko).page = p; updatePageInfo(lang); }
      }
    });
  }, { root: viewer, threshold: 0.4 });
  new MutationObserver(() => {
    viewer.querySelectorAll('.pdf-page-container').forEach(el => obs.observe(el));
  }).observe(viewer, { childList: true, subtree: true });
}

// ── Zoom ──────────────────────────────────────────────────
const ZOOM_STEP = 0.2, ZOOM_MIN = 0.5, ZOOM_MAX = 3.0;

async function adjustZoom(lang, delta) {
  const s = lang === 'en' ? state.en : state.ko;
  const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(s.scale + delta).toFixed(1)));
  if (newScale === s.scale) return;
  s.scale = newScale;
  const lbl = lang === 'en' ? dom.zoomLabelEn : dom.zoomLabelKo;
  lbl.textContent = Math.round(newScale * 100) + '%';
  await renderAllPages(lang);
}

// ── Drag & drop ───────────────────────────────────────────
function setupDrop(dropEl, lang) {
  dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('drag-over'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('drag-over'));
  dropEl.addEventListener('drop', e => {
    e.preventDefault(); dropEl.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f?.type === 'application/pdf') loadPDF(f, lang);
    else showToast('Please drop a PDF file.');
  });
}

// =========================================================
// View toggling — PDF ↔ Parallel
// =========================================================

function switchView(view) {
  state.view = view;
  dom.pdfView.hidden      = view !== 'pdf';
  dom.parallelView.hidden = view !== 'parallel';
  dom.btnPdfView.classList.toggle('active', view === 'pdf');
  dom.btnParallelView.classList.toggle('active', view === 'parallel');
  if (view === 'parallel') buildParallelView();
}

// =========================================================
// Parallel View — text extraction & rendering
// =========================================================

async function extractParagraphs(doc) {
  const pages = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page    = await doc.getPage(i);
    const content = await page.getTextContent();

    const items = content.items.filter(it => it.str && it.str.trim());
    if (!items.length) { pages.push({ pageNum: i, paragraphs: [] }); continue; }

    // Sort top-to-bottom, then left-to-right within the same line
    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 4) return yDiff;
      return a.transform[4] - b.transform[4];
    });

    // Bucket items into lines: items within 5 pts of Y share a line
    const lines = [];
    for (const item of items) {
      const y    = item.transform[5];
      const last = lines[lines.length - 1];
      if (last && Math.abs(y - last.y) <= 5) {
        last.parts.push(item.str);
      } else {
        lines.push({ y, parts: [item.str] });
      }
    }

    // Measure the *median* Y-gap between consecutive lines.
    // This adapts to whatever font size / line-height the PDF uses —
    // works for Korean (세로 간격), English, and mixed documents.
    const gaps = [];
    for (let j = 1; j < lines.length; j++) {
      gaps.push(Math.abs(lines[j - 1].y - lines[j].y));
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps[Math.floor(gaps.length / 2)] || 12;
    const paraBreak = medianGap * 2.0; // gap > 2× typical line-height = new paragraph

    // Group lines into paragraphs
    const paragraphs = [];
    let curPara = [];
    for (let j = 0; j < lines.length; j++) {
      const lineText = lines[j].parts.join('').replace(/\s+/g, ' ').trim();
      if (!lineText) continue;
      if (j > 0 && Math.abs(lines[j - 1].y - lines[j].y) > paraBreak) {
        if (curPara.length) paragraphs.push(curPara.join(' '));
        curPara = [];
      }
      curPara.push(lineText);
    }
    if (curPara.length) paragraphs.push(curPara.join(' '));

    pages.push({ pageNum: i, paragraphs: paragraphs.filter(p => p.trim()) });
  }

  return pages;
}

async function buildParallelView() {
  if (!state.en.doc && !state.ko.doc) {
    // Still show placeholder
    return;
  }

  dom.parallelBody.innerHTML = `<div class="pdf-loading"><div class="spinner"></div><span>Extracting text from PDFs…</span></div>`;

  try {
    const [enPages, koPages] = await Promise.all([
      state.en.doc ? extractParagraphs(state.en.doc) : Promise.resolve([]),
      state.ko.doc ? extractParagraphs(state.ko.doc) : Promise.resolve([]),
    ]);

    dom.parallelBody.innerHTML = '';

    const maxPages = Math.max(enPages.length, koPages.length);

    for (let p = 0; p < maxPages; p++) {
      const enPage = enPages[p];
      const koPage = koPages[p];

      // Page separator row
      const sep = document.createElement('div');
      sep.className = 'par-page-sep';
      sep.innerHTML = `<span>Page ${p + 1}</span>`;
      dom.parallelBody.appendChild(sep);

      const maxParas = Math.max(
        enPage?.paragraphs?.length ?? 0,
        koPage?.paragraphs?.length ?? 0
      );

      for (let r = 0; r < maxParas; r++) {
        const row  = document.createElement('div');
        row.className = 'par-row';

        const enCell = document.createElement('div');
        enCell.className = 'par-cell';
        enCell.dataset.lang = 'en';
        enCell.textContent  = enPage?.paragraphs?.[r] ?? '';

        const koCell = document.createElement('div');
        koCell.className = 'par-cell';
        koCell.dataset.lang = 'ko';
        koCell.textContent  = koPage?.paragraphs?.[r] ?? '';

        row.appendChild(enCell);
        row.appendChild(koCell);
        dom.parallelBody.appendChild(row);
      }
    }

    if (maxPages === 0) {
      dom.parallelBody.innerHTML = `<div class="par-placeholder"><p>No text could be extracted.<br>Make sure your PDFs contain selectable text (not scanned images).</p></div>`;
    }
  } catch (err) {
    dom.parallelBody.innerHTML = `<div class="par-placeholder"><p style="color:#ff6060">Error extracting text: ${escHtml(err.message)}</p></div>`;
    console.error(err);
  }
}

// =========================================================
// Selection → Action Bar
// =========================================================

function getSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().trim();
  if (text.length < 1) return null;

  // Resolve to an element (text nodes don't have .closest)
  const anchor = sel.anchorNode?.nodeType === Node.TEXT_NODE
    ? sel.anchorNode.parentElement
    : /** @type {Element} */ (sel.anchorNode);

  if (!anchor) return null;

  // Parallel view cells — check first so they take priority
  const parCell = anchor.closest?.('.par-cell');
  if (parCell) return { text, lang: parCell.dataset.lang || '' };

  // PDF panels
  if (anchor.closest?.('#panel-en')) return { text, lang: 'en' };
  if (anchor.closest?.('#panel-ko')) return { text, lang: 'ko' };

  return null;
}

function showSelBar(x, y) {
  const bar = dom.selBar;
  bar.hidden = false;

  // Position above cursor, clamped to viewport
  const bw = 160, bh = 36, margin = 10;
  let left = x - bw / 2;
  let top  = y - bh - 12;

  left = Math.max(margin, Math.min(left, window.innerWidth  - bw - margin));
  top  = Math.max(margin, Math.min(top,  window.innerHeight - bh - margin));

  bar.style.left = left + 'px';
  bar.style.top  = top  + 'px';
}

function hideSelBar() {
  dom.selBar.hidden = true;
  state.selText = '';
  state.selLang = '';
}

// =========================================================
// Flashcard Modal
// =========================================================

function openCardModal(front, lang, back = '') {
  state.selText = front;
  state.selLang = lang;
  dom.cardFront.value = front;
  dom.cardBack.value  = back;
  dom.cardNotes.value = '';
  dom.cardModal.hidden   = false;
  dom.cardOverlay.hidden = false;
  setTimeout(() => dom.cardBack.focus(), 50);
}

function closeCardModal() {
  dom.cardModal.hidden   = true;
  dom.cardOverlay.hidden = true;
  window.getSelection()?.removeAllRanges();
}

function saveCard(front, back, notes, lang) {
  if (!front && !back) { showToast('Enter at least a front or back.'); return false; }
  state.flashcards.unshift({
    id: Date.now(), front, back, notes, lang,
    created: new Date().toISOString(),
  });
  saveCards(); renderCardList(); updateBadge();
  return true;
}

function saveCardFromModal() {
  const ok = saveCard(
    dom.cardFront.value.trim(),
    dom.cardBack.value.trim(),
    dom.cardNotes.value.trim(),
    state.selLang
  );
  if (ok) { closeCardModal(); showToast('Card saved!'); }
}

// =========================================================
// Flashcard Panel
// =========================================================

function toggleFCPanel() {
  state.fcOpen = !state.fcOpen;
  dom.fcPanel.hidden = !state.fcOpen;
  // Close dict if opening FC
  if (state.fcOpen && state.dictOpen) closeDictSidebar();
  if (!state.fcOpen && state.studyMode) exitStudyMode();
  if (state.fcOpen) renderCardList();
}

function closeFCPanel() {
  state.fcOpen = false;
  dom.fcPanel.hidden = true;
  if (state.studyMode) exitStudyMode();
}

function renderCardList() {
  const cards = state.flashcards;
  dom.fcEmpty.hidden = cards.length > 0;
  dom.fcList.innerHTML = '';
  cards.forEach((card, idx) => {
    const li = document.createElement('li');
    li.className = 'fc-item';
    li.innerHTML = `
      <div class="fc-item-front">${escHtml(card.front)}</div>
      ${card.back  ? `<div class="fc-item-back">${escHtml(card.back)}</div>`   : ''}
      ${card.notes ? `<div class="fc-item-notes">${escHtml(card.notes)}</div>` : ''}
      <div class="fc-item-footer">
        <button class="btn btn-danger btn-sm" data-idx="${idx}">Delete</button>
      </div>`;
    dom.fcList.appendChild(li);
  });
  dom.fcList.querySelectorAll('[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.flashcards.splice(parseInt(btn.dataset.idx, 10), 1);
      saveCards(); renderCardList(); updateBadge();
      showToast('Card deleted.');
    });
  });
}

function updateBadge() { dom.fcCount.textContent = state.flashcards.length; }

// ── Study mode ────────────────────────────────────────────
function enterStudyMode() {
  if (!state.flashcards.length) { showToast('Add cards first!'); return; }
  state.studyMode = true; state.studyIndex = 0; state.studyFlipped = false;
  dom.fcListView.hidden  = true;
  dom.fcStudyView.hidden = false;
  renderStudyCard();
}

function exitStudyMode() {
  state.studyMode = false;
  dom.fcStudyView.hidden = true;
  dom.fcListView.hidden  = false;
}

function renderStudyCard() {
  const card = state.flashcards[state.studyIndex];
  if (!card) return;
  dom.studyFront.textContent = card.front || '—';
  dom.studyBack.textContent  = card.back  || '—';
  dom.studyNotes.textContent = card.notes || '';
  dom.studyNotes.hidden = !card.notes;
  dom.studyCounter.textContent = `${state.studyIndex + 1} / ${state.flashcards.length}`;
  state.studyFlipped = false;
  dom.studyInner.classList.remove('flipped');
}

function flipStudyCard() {
  state.studyFlipped = !state.studyFlipped;
  dom.studyInner.classList.toggle('flipped', state.studyFlipped);
}

function studyNav(d) {
  const len = state.flashcards.length;
  state.studyIndex = (state.studyIndex + d + len) % len;
  renderStudyCard();
}

// =========================================================
// Dictionary — KRDict API
// =========================================================

function openDictSidebar() {
  state.dictOpen = true;
  dom.dictSidebar.hidden = false;
  // Close FC panel if open
  if (state.fcOpen) closeFCPanel();
}

function closeDictSidebar() {
  state.dictOpen = false;
  dom.dictSidebar.hidden = true;
}

// Uses Wiktionary — free, no API key required, CORS-open.
async function lookupWord(term) {
  openDictSidebar();

  dom.dictBody.innerHTML = `
    <div class="dict-loading">
      <div class="spinner"></div>
      <span>Looking up "${escHtml(term)}"…</span>
    </div>`;

  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`;

  try {
    const res = await fetch(url);
    if (res.status === 404) {
      dom.dictBody.innerHTML = `
        <div class="dict-empty">
          No entry found for "<strong>${escHtml(term)}</strong>".<br>
          <small>Try the base/dictionary form of the word,<br>
          or use the MCP server in Claude Code for richer results.</small>
        </div>`;
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderWiktionaryResults(term, data);
  } catch (err) {
    dom.dictBody.innerHTML = `<div class="dict-error">Lookup failed: ${escHtml(err.message)}</div>`;
  }
}

function renderWiktionaryResults(term, data) {
  dom.dictBody.innerHTML = '';

  const termEl = document.createElement('div');
  termEl.className = 'dict-lookup-term';
  termEl.textContent = term;
  dom.dictBody.appendChild(termEl);

  // Wiktionary sections by language code — 'ko' for Korean
  const entries = data['ko'] || data['en'] || [];

  if (!entries.length) {
    const el = document.createElement('div');
    el.className = 'dict-empty';
    el.innerHTML = `
      No Korean entries for "<strong>${escHtml(term)}</strong>".<br>
      <small>Coverage varies — try the MCP server in Claude Code<br>
      for definitions Claude can explain in context.</small>`;
    dom.dictBody.appendChild(el);
    return;
  }

  let count = 0;
  for (const entry of entries) {
    if (count >= 5) break;
    const pos = entry.partOfSpeech || '';

    for (const def of (entry.definitions || [])) {
      if (count >= 5) break;
      // Strip HTML tags Wiktionary includes in definitions
      const clean = (def.definition || '').replace(/<[^>]+>/g, '').trim();
      if (!clean) continue;
      count++;

      const el = document.createElement('div');
      el.className = 'dict-entry';
      el.innerHTML = `
        ${pos ? `<span class="dict-pos">${escHtml(pos)}</span>` : ''}
        <div class="dict-def">${escHtml(clean)}</div>
        <button class="btn btn-ghost btn-sm dict-add-btn">+ Add to Flashcards</button>`;

      const btn = el.querySelector('.dict-add-btn');
      btn.addEventListener('click', () => {
        if (saveCard(term, clean, '', 'ko')) {
          showToast('Card added!');
          btn.textContent = '✓ Added';
          btn.disabled = true;
        }
      });

      dom.dictBody.appendChild(el);
    }
  }
}

// =========================================================
// Settings
// =========================================================

function openSettings() {
  dom.settingsModal.hidden   = false;
  dom.settingsOverlay.hidden = false;
}

function closeSettings() {
  dom.settingsModal.hidden   = true;
  dom.settingsOverlay.hidden = true;
}

function saveSettings() {
  closeSettings();
}

// =========================================================
// Print / Download
// =========================================================

function openPrint() {
  if (state.view === 'parallel') {
    printParallelLines();
  } else {
    printFlashcards();
  }
}

function printParallelLines() {
  if (!state.en.doc && !state.ko.doc) {
    showToast('Upload at least one PDF first.');
    return;
  }
  document.body.classList.add('print-parallel');
  window.print();
  document.body.classList.remove('print-parallel');
}

function printFlashcards() {
  if (!state.flashcards.length) { showToast('No flashcards to print.'); return; }
  dom.printDate.textContent = `Generated ${new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  })}`;
  dom.printCards.innerHTML = '';
  state.flashcards.forEach((card, i) => {
    const d = document.createElement('div');
    d.className = 'print-card';
    d.innerHTML = `
      <div class="print-card-num">#${i + 1}</div>
      <div class="print-card-front">${escHtml(card.front)}</div>
      <div class="print-card-back">${escHtml(card.back)}</div>
      ${card.notes ? `<div class="print-card-notes">${escHtml(card.notes)}</div>` : ''}`;
    dom.printCards.appendChild(d);
  });
  window.print();
}

// =========================================================
// Event wiring
// =========================================================

function init() {
  // File uploads
  dom.uploadEn.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) { loadPDF(f, 'en'); e.target.value = ''; }
  });
  dom.uploadKo.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) { loadPDF(f, 'ko'); e.target.value = ''; }
  });

  // Drag & drop
  setupDrop(dom.dropEn, 'en');
  setupDrop(dom.dropKo, 'ko');

  // View toggle
  dom.btnPdfView.addEventListener('click', () => switchView('pdf'));
  dom.btnParallelView.addEventListener('click', () => switchView('parallel'));

  // Page nav
  dom.prevEn.addEventListener('click', () => goPage('en', -1));
  dom.nextEn.addEventListener('click', () => goPage('en',  1));
  dom.prevKo.addEventListener('click', () => goPage('ko', -1));
  dom.nextKo.addEventListener('click', () => goPage('ko',  1));

  // Zoom
  dom.zoomInEn.addEventListener('click',  () => adjustZoom('en',  ZOOM_STEP));
  dom.zoomOutEn.addEventListener('click', () => adjustZoom('en', -ZOOM_STEP));
  dom.zoomInKo.addEventListener('click',  () => adjustZoom('ko',  ZOOM_STEP));
  dom.zoomOutKo.addEventListener('click', () => adjustZoom('ko', -ZOOM_STEP));

  // Selection → action bar
  document.addEventListener('mouseup', e => {
    if (!dom.cardModal.hidden || !dom.settingsModal.hidden) return;
    if (dom.selBar.contains(e.target)) return;

    const cx = e.clientX, cy = e.clientY;

    const check = () => {
      const result = getSelection();
      if (result && result.text.length > 0) {
        state.selText = result.text;
        state.selLang = result.lang;
        showSelBar(cx, cy);
      } else {
        hideSelBar();
      }
    };

    // Parallel-view cells are plain HTML — selection is ready immediately.
    // PDF text-layer spans need a tick for the browser to finalise the range.
    check();
    if (dom.selBar.hidden) setTimeout(check, 60);
  });

  // Clicking elsewhere hides the action bar
  document.addEventListener('mousedown', e => {
    if (!dom.selBar.hidden && !dom.selBar.contains(e.target)) {
      hideSelBar();
    }
  });

  // Action bar buttons
  $('sel-add-card').addEventListener('click', () => {
    const text = state.selText, lang = state.selLang;
    hideSelBar();
    window.getSelection()?.removeAllRanges();
    openCardModal(text, lang);
  });
  $('sel-lookup').addEventListener('click', () => {
    const text = state.selText;
    hideSelBar();
    window.getSelection()?.removeAllRanges();
    lookupWord(text);
  });

  // Card modal
  dom.cardOverlay.addEventListener('click', closeCardModal);
  $('card-cancel').addEventListener('click', closeCardModal);
  $('card-save').addEventListener('click', saveCardFromModal);

  // Flashcard panel
  $('btn-flashcards').addEventListener('click', toggleFCPanel);
  $('btn-close-fc').addEventListener('click', closeFCPanel);
  $('btn-study-mode').addEventListener('click', enterStudyMode);
  $('btn-exit-study').addEventListener('click', exitStudyMode);
  dom.studyCard.addEventListener('click', flipStudyCard);
  $('study-prev').addEventListener('click', () => studyNav(-1));
  $('study-next').addEventListener('click', () => studyNav( 1));

  // Dictionary sidebar
  $('btn-close-dict').addEventListener('click', closeDictSidebar);

  // Settings
  $('btn-settings').addEventListener('click', openSettings);
  dom.settingsOverlay.addEventListener('click', closeSettings);
  $('btn-close-settings').addEventListener('click', closeSettings);
  $('settings-save').addEventListener('click', saveSettings);

  // Print
  $('btn-download').addEventListener('click', openPrint);

  // Page trackers
  setupPageTracker('en');
  setupPageTracker('ko');

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (!dom.cardModal.hidden) {
      if (e.key === 'Escape') closeCardModal();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveCardFromModal();
      return;
    }
    if (!dom.settingsModal.hidden) {
      if (e.key === 'Escape') closeSettings();
      if (e.key === 'Enter') saveSettings();
      return;
    }
    if (e.key === 'Escape') {
      hideSelBar();
      closeDictSidebar();
      return;
    }
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) toggleFCPanel();
    if (state.studyMode) {
      if (e.key === 'ArrowLeft')  studyNav(-1);
      if (e.key === 'ArrowRight') studyNav( 1);
      if (e.key === ' ') { e.preventDefault(); flipStudyCard(); }
    }
  });

  // Initial state
  renderCardList();
  updateBadge();
}

document.addEventListener('DOMContentLoaded', init);
