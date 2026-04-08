/* =========================================================
   DocSync — Side-by-Side Translation App
   ========================================================= */

'use strict';

// ── PDF.js worker ──────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── State ─────────────────────────────────────────────────
const state = {
  en: { doc: null, page: 1, total: 0, scale: 1.2, rendering: false },
  ko: { doc: null, page: 1, total: 0, scale: 1.2, rendering: false },
  flashcards: loadCards(),
  fcPanelOpen: false,
  studyMode: false,
  studyIndex: 0,
  studyFlipped: false,
  pendingSelection: '',
  pendingLang: '',
};

// ── DOM refs ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  // panels
  panelEn: $('panel-en'),
  panelKo: $('panel-ko'),
  dropEn:  $('drop-en'),
  dropKo:  $('drop-ko'),
  viewerEn: $('viewer-en'),
  viewerKo: $('viewer-ko'),
  uploadEn: $('upload-en'),
  uploadKo: $('upload-ko'),
  // controls
  controlsEn: $('controls-en'),
  controlsKo: $('controls-ko'),
  prevEn: $('prev-en'), nextEn: $('next-en'), pageInfoEn: $('page-info-en'),
  prevKo: $('prev-ko'), nextKo: $('next-ko'), pageInfoKo: $('page-info-ko'),
  zoomInEn: $('zoom-in-en'), zoomOutEn: $('zoom-out-en'), zoomLabelEn: $('zoom-label-en'),
  zoomInKo: $('zoom-in-ko'), zoomOutKo: $('zoom-out-ko'), zoomLabelKo: $('zoom-label-ko'),
  // flashcard panel
  fcPanel: $('flashcard-panel'),
  fcList:  $('fc-list'),
  fcEmpty: $('fc-empty'),
  fcCount: $('flashcard-count'),
  fcListView:  $('fc-list-view'),
  fcStudyView: $('fc-study-view'),
  studyCard:  $('study-card'),
  studyInner: $('study-card-inner'),
  studyFront: $('study-front-text'),
  studyBack:  $('study-back-text'),
  studyNotes: $('study-notes-text'),
  studyCounter: $('study-counter'),
  // highlight popup
  popup:        $('highlight-popup'),
  popupOverlay: $('highlight-overlay'),
  cardFront:    $('card-front'),
  cardBack:     $('card-back'),
  cardNotes:    $('card-notes'),
  // print
  printSheet: $('print-sheet'),
  printCards: $('print-cards'),
  printDate:  $('print-date'),
  // toast
  toast: $('toast'),
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
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2200);
}

// ── PDF Loading ───────────────────────────────────────────
async function loadPDF(file, lang) {
  const s = state[lang];
  const viewer = lang === 'en' ? dom.viewerEn : dom.viewerKo;
  const drop   = lang === 'en' ? dom.dropEn   : dom.dropKo;
  const controls = lang === 'en' ? dom.controlsEn : dom.controlsKo;

  // Show loading state
  drop.querySelector('.drop-prompt').hidden = true;
  viewer.hidden = false;
  viewer.innerHTML = `
    <div class="pdf-loading">
      <div class="spinner"></div>
      <span>Loading PDF…</span>
    </div>`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    s.doc   = pdf;
    s.total = pdf.numPages;
    s.page  = 1;

    controls.hidden = false;

    // Render all pages
    await renderAllPages(lang);
    updatePageInfo(lang);

    showToast(`Loaded ${pdf.numPages} page${pdf.numPages !== 1 ? 's' : ''}`);
  } catch (err) {
    viewer.innerHTML = `<div class="pdf-loading" style="color:#ff4d4d">Failed to load PDF.<br><small>${err.message}</small></div>`;
    console.error(err);
  }
}

async function renderAllPages(lang) {
  const s = state[lang];
  if (!s.doc) return;

  const viewer = lang === 'en' ? dom.viewerEn : dom.viewerKo;

  // Create wrapper
  viewer.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-pages-wrapper';
  viewer.appendChild(wrapper);

  // Render pages sequentially to avoid memory spikes on large PDFs
  for (let i = 1; i <= s.total; i++) {
    const pageContainer = await renderPage(s.doc, i, s.scale, lang);
    wrapper.appendChild(pageContainer);
  }
}

async function renderPage(doc, pageNum, scale, lang) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // Container
  const container = document.createElement('div');
  container.className = 'pdf-page-container';
  container.dataset.page = pageNum;
  container.style.width  = viewport.width  + 'px';
  container.style.height = viewport.height + 'px';

  // Page label
  const label = document.createElement('div');
  label.className = 'page-label';
  label.textContent = `Page ${pageNum}`;
  container.appendChild(label);

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Text layer (for selection + copy)
  const textContent = await page.getTextContent();
  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';
  container.appendChild(textLayer);

  pdfjsLib.renderTextLayer({
    textContentSource: textContent,   // PDF.js 3.x API
    container: textLayer,
    viewport,
    textDivs: [],
  });

  // Track which language this page belongs to for flashcard sourcing
  container.dataset.lang = lang;

  return container;
}

// ── Re-render on zoom ─────────────────────────────────────
async function reRender(lang) {
  const s = state[lang];
  if (!s.doc) return;
  await renderAllPages(lang);
}

// ── Page info + navigation ────────────────────────────────
function updatePageInfo(lang) {
  const s = state[lang];
  const info  = lang === 'en' ? dom.pageInfoEn  : dom.pageInfoKo;
  const prev  = lang === 'en' ? dom.prevEn  : dom.prevKo;
  const next  = lang === 'en' ? dom.nextEn  : dom.nextKo;
  info.textContent = `${s.page} / ${s.total}`;
  prev.disabled = s.page <= 1;
  next.disabled = s.page >= s.total;
}

function scrollToPage(lang, pageNum) {
  const viewer = lang === 'en' ? dom.viewerEn : dom.viewerKo;
  const target = viewer.querySelector(`[data-page="${pageNum}"]`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  state[lang].page = pageNum;
  updatePageInfo(lang);
}

function goPage(lang, delta) {
  const s = state[lang];
  const newPage = s.page + delta;
  if (newPage < 1 || newPage > s.total) return;
  scrollToPage(lang, newPage);
}

// Track current page via IntersectionObserver
function setupPageTracker(lang) {
  const viewer = lang === 'en' ? dom.viewerEn : dom.viewerKo;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const p = parseInt(entry.target.dataset.page, 10);
        if (!isNaN(p)) {
          state[lang].page = p;
          updatePageInfo(lang);
        }
      }
    });
  }, { root: viewer, threshold: 0.4 });

  // Observe pages as they are added
  const mo = new MutationObserver(() => {
    viewer.querySelectorAll('.pdf-page-container').forEach(el => {
      observer.observe(el);
    });
  });
  mo.observe(viewer, { childList: true, subtree: true });
}

// ── Highlight & popup ─────────────────────────────────────
function getSelectedText() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return { text: '', lang: '' };
  const text = sel.toString().trim();
  if (!text) return { text: '', lang: '' };

  // Determine which panel the selection is in
  let node = sel.anchorNode;
  while (node && node !== document.body) {
    if (node.id === 'panel-en') return { text, lang: 'en' };
    if (node.id === 'panel-ko') return { text, lang: 'ko' };
    node = node.parentNode;
  }
  return { text, lang: '' };
}

function openPopup(front, lang) {
  state.pendingSelection = front;
  state.pendingLang = lang;
  dom.cardFront.value = front;
  dom.cardBack.value  = '';
  dom.cardNotes.value = '';
  dom.popup.hidden = false;
  dom.popupOverlay.hidden = false;
  dom.cardBack.focus();
}

function closePopup() {
  dom.popup.hidden = true;
  dom.popupOverlay.hidden = true;
  window.getSelection()?.removeAllRanges();
}

function saveNewCard() {
  const front = dom.cardFront.value.trim();
  const back  = dom.cardBack.value.trim();
  const notes = dom.cardNotes.value.trim();
  if (!front && !back) { showToast('Please enter at least a front or back.'); return; }

  const card = {
    id: Date.now(),
    front,
    back,
    notes,
    lang: state.pendingLang,
    created: new Date().toISOString(),
  };

  state.flashcards.unshift(card);
  saveCards();
  renderCardList();
  updateBadge();
  closePopup();
  showToast('Card saved!');
}

// ── Flashcard list rendering ──────────────────────────────
function renderCardList() {
  const cards = state.flashcards;
  dom.fcEmpty.hidden = cards.length > 0;
  dom.fcList.innerHTML = '';

  cards.forEach((card, idx) => {
    const li = document.createElement('li');
    li.className = 'fc-item';
    li.innerHTML = `
      <div class="fc-item-front">${escHtml(card.front)}</div>
      ${card.back  ? `<div class="fc-item-back">${escHtml(card.back)}</div>` : ''}
      ${card.notes ? `<div class="fc-item-notes">${escHtml(card.notes)}</div>` : ''}
      <div class="fc-item-footer">
        <button class="btn btn-danger btn-sm" data-idx="${idx}" title="Delete">Delete</button>
      </div>`;
    dom.fcList.appendChild(li);
  });

  dom.fcList.querySelectorAll('[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      state.flashcards.splice(i, 1);
      saveCards();
      renderCardList();
      updateBadge();
      showToast('Card deleted.');
    });
  });
}

function updateBadge() {
  dom.fcCount.textContent = state.flashcards.length;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Study mode ────────────────────────────────────────────
function enterStudyMode() {
  if (state.flashcards.length === 0) { showToast('Add some cards first!'); return; }
  state.studyMode  = true;
  state.studyIndex = 0;
  state.studyFlipped = false;
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

function studyNav(delta) {
  const len = state.flashcards.length;
  state.studyIndex = (state.studyIndex + delta + len) % len;
  renderStudyCard();
}

// ── Print / Download ──────────────────────────────────────
function openPrint() {
  if (state.flashcards.length === 0) { showToast('No flashcards to print.'); return; }

  dom.printDate.textContent = `Generated ${new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  })}`;

  dom.printCards.innerHTML = '';
  state.flashcards.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'print-card';
    div.innerHTML = `
      <div class="print-card-num">#${i + 1}</div>
      <div class="print-card-front">${escHtml(card.front)}</div>
      <div class="print-card-back">${escHtml(card.back)}</div>
      ${card.notes ? `<div class="print-card-notes">${escHtml(card.notes)}</div>` : ''}`;
    dom.printCards.appendChild(div);
  });

  window.print();
}

// ── Drag and drop ─────────────────────────────────────────
function setupDrop(dropEl, lang) {
  dropEl.addEventListener('dragover', e => {
    e.preventDefault();
    dropEl.classList.add('drag-over');
  });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('drag-over'));
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    dropEl.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') loadPDF(file, lang);
    else showToast('Please drop a PDF file.');
  });
}

// ── Zoom ──────────────────────────────────────────────────
const ZOOM_STEP  = 0.2;
const ZOOM_MIN   = 0.5;
const ZOOM_MAX   = 3.0;

async function adjustZoom(lang, delta) {
  const s = state[lang];
  const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(s.scale + delta).toFixed(1)));
  if (newScale === s.scale) return;
  s.scale = newScale;
  const label = lang === 'en' ? dom.zoomLabelEn : dom.zoomLabelKo;
  label.textContent = Math.round(newScale * 100) + '%';
  await reRender(lang);
}

// ── Event wiring ──────────────────────────────────────────
function init() {
  // File upload inputs
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

  // Page navigation
  dom.prevEn.addEventListener('click', () => goPage('en', -1));
  dom.nextEn.addEventListener('click', () => goPage('en',  1));
  dom.prevKo.addEventListener('click', () => goPage('ko', -1));
  dom.nextKo.addEventListener('click', () => goPage('ko',  1));

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (dom.popup.hidden === false) {
      if (e.key === 'Escape') closePopup();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNewCard();
      return;
    }
    if (e.key === 'f' || e.key === 'F') toggleFCPanel();
    if (state.studyMode) {
      if (e.key === 'ArrowLeft')  studyNav(-1);
      if (e.key === 'ArrowRight') studyNav( 1);
      if (e.key === ' ') { e.preventDefault(); flipStudyCard(); }
    }
  });

  // Zoom
  dom.zoomInEn.addEventListener('click',  () => adjustZoom('en',  ZOOM_STEP));
  dom.zoomOutEn.addEventListener('click', () => adjustZoom('en', -ZOOM_STEP));
  dom.zoomInKo.addEventListener('click',  () => adjustZoom('ko',  ZOOM_STEP));
  dom.zoomOutKo.addEventListener('click', () => adjustZoom('ko', -ZOOM_STEP));

  // Detect text selection in PDF viewers
  document.addEventListener('mouseup', e => {
    // Don't trigger if clicking inside the popup
    if (!dom.popup.hidden) return;

    setTimeout(() => {
      const { text, lang } = getSelectedText();
      if (text.length > 0) {
        openPopup(text, lang);
      }
    }, 10);
  });

  // Popup actions
  dom.popupOverlay.addEventListener('click', closePopup);
  $('popup-cancel').addEventListener('click', closePopup);
  $('popup-save').addEventListener('click', saveNewCard);

  // Flashcard panel toggle
  $('btn-flashcards').addEventListener('click', toggleFCPanel);
  $('btn-close-fc').addEventListener('click', toggleFCPanel);

  // Study mode
  $('btn-study-mode').addEventListener('click', enterStudyMode);
  $('btn-exit-study').addEventListener('click', exitStudyMode);
  dom.studyCard.addEventListener('click', flipStudyCard);
  $('study-prev').addEventListener('click', () => studyNav(-1));
  $('study-next').addEventListener('click', () => studyNav( 1));

  // Print / download
  $('btn-download').addEventListener('click', openPrint);

  // Page tracker
  setupPageTracker('en');
  setupPageTracker('ko');

  // Initial render
  renderCardList();
  updateBadge();
}

function toggleFCPanel() {
  state.fcPanelOpen = !state.fcPanelOpen;
  dom.fcPanel.hidden = !state.fcPanelOpen;
  if (!state.fcPanelOpen && state.studyMode) exitStudyMode();
  if (state.fcPanelOpen) renderCardList();
}

// ── Boot ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
