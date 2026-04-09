/* global chrome */
(() => {
  const CLUE_ITEM_SELECTOR = '[data-test="clue"], li[class*="Clue-li"], .xwd__clue--li';
  const CLUE_LABEL_SELECTOR = '[data-test="clue-label"], .Clue-label, .xwd__clue--label';
  const CLUE_TEXT_SELECTOR = '[data-test="clue-text"], .Clue-text, .xwd__clue--text';
  const LISTENER_FLAG = 'nytcsListener';
  const STYLE_ID = 'nytcs-styles';
  const EXTERNAL_HOST = 'https://nytcrosswordanswers.org';
  const EXTERNAL_PATH_PREFIX = `${EXTERNAL_HOST}/nyt-crossword-answers-`;
  const MESSAGE_TYPE_FETCH = 'nytcs-fetch-html';
  const FALLBACK_NOTICE_ID = 'nytcs-fallback-notice';
  const PANEL_ID = 'nytcs-answer-panel';
  const PANEL_VISIBLE_ATTR = 'data-visible';
  const PANEL_ANSWER_ATTR = 'data-clue-key';

  let answerPanel = null;
  let answerMapRef = {};

  init();

  async function init() {
    try {
      const puzzleDate = derivePuzzleDate();
      if (!puzzleDate) {
        showFallbackNotice(
          'NYT Answer Helper: Could not determine this puzzle’s date, so no answers are available.'
        );
        return;
      }

      const slug = formatDateSlug(puzzleDate);
      if (!slug) {
        showFallbackNotice('NYT Answer Helper: The puzzle date looks invalid.');
        return;
      }

      const answerMap = await buildAnswerMapFromExternal(slug);
      answerMapRef = answerMap;
      if (!hasEntries(answerMap)) {
        showFallbackNotice(
          `NYT Answer Helper: No answers were found on nytcrosswordanswers.org for ${slug}.`
        );
        return;
      }

      injectStyles();
      const panel = ensureAnswerPanel(true);
      if (panel) {
        panel.querySelector('[data-role="clue-key"]').textContent = 'READY';
        panel.querySelector('[data-role="clue-text"]').textContent =
          'Click any clue to reveal its answer below.';
        panel.querySelector('[data-role="answer-text"]').textContent = '—';
        panel.setAttribute(PANEL_VISIBLE_ATTR, 'true');
        console.info('[NYT Answer Helper] Answer panel initialized.');
      }
      enhanceClues(answerMap);
      console.info(
        `[NYT Answer Helper] Ready — answers loaded exclusively from nytcrosswordanswers.org (${slug}).`
      );
    } catch (error) {
      console.warn('[NYT Answer Helper] Initialization failed:', error);
      showFallbackNotice('NYT Answer Helper: Unable to load answers for this puzzle.');
    }
  }

  async function buildAnswerMapFromExternal(slug) {
    const url = `${EXTERNAL_PATH_PREFIX}${slug}/`;
    const html = await requestExternalHtml(url);
    const map = parseExternalAnswerMap(html);
    return map;
  }

  function derivePuzzleDate() {
    // Tier 1: Extract date from inline <script> tags containing window.gameData.
    // Content scripts can't access page JS variables directly (isolated world),
    // but they CAN read <script> tag textContent from the DOM.
    const scriptDate = extractDateFromScriptTags();
    if (scriptDate) {
      console.debug('[NYT Answer Helper] Date from script tags:', scriptDate);
      return scriptDate;
    }

    // Tier 2: Extract date from URL path (e.g., /crosswords/game/daily/2026/04/09).
    const pathMatch = window.location.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})/);
    if (pathMatch) {
      console.debug('[NYT Answer Helper] Date from URL path.');
      return {
        year: Number(pathMatch[1]),
        month: Number(pathMatch[2]),
        day: Number(pathMatch[3]),
      };
    }

    // Tier 3: Fall back to today's date. The daily puzzle at /crosswords/game/daily
    // is always today's puzzle, so this is a safe default.
    const now = new Date();
    console.debug('[NYT Answer Helper] Falling back to today\'s date.');
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };
  }

  function extractDateFromScriptTags() {
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent || '';
      // Look for gameData assignment containing a filename like "daily/2023-09-08"
      const filenameMatch = text.match(/gameData\s*=\s*\{[^}]*"filename"\s*:\s*"[^"]*\/(\d{4})-(\d{2})-(\d{2})"/);
      if (filenameMatch) {
        return {
          year: Number(filenameMatch[1]),
          month: Number(filenameMatch[2]),
          day: Number(filenameMatch[3]),
        };
      }
      // Also try puzzleData.date or date property directly
      const dateMatch = text.match(/["']date["']\s*:\s*["'](\d{4})-(\d{2})-(\d{2})["']/);
      if (dateMatch) {
        return {
          year: Number(dateMatch[1]),
          month: Number(dateMatch[2]),
          day: Number(dateMatch[3]),
        };
      }
    }
    return null;
  }

  function formatDateSlug(parts) {
    if (!parts) {
      return null;
    }

    const { year, month, day } = parts;
    if (![year, month, day].every((value) => Number.isInteger(value))) {
      return null;
    }

    const yy = String(year).slice(-2);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${mm}-${dd}-${yy}`;
  }

  function parseExternalAnswerMap(html) {
    if (typeof html !== 'string' || !html.trim()) {
      return {};
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const entries = doc.querySelectorAll('.nywrap ul li');
    const map = {};

    entries.forEach((item) => {
      const rawLabel = item.childNodes?.[0]?.textContent?.trim();
      const answerText = item.querySelector('span')?.textContent?.trim();
      if (!rawLabel || !answerText) {
        return;
      }

      const keyMatch = rawLabel.match(/^(\d+)\s*([A-Za-z])/);
      if (!keyMatch) {
        return;
      }

      const clueKey = `${keyMatch[1]}${keyMatch[2].toUpperCase()}`;
      const sanitizedAnswer = answerText.replace(/\s+/g, '').toUpperCase();
      if (!sanitizedAnswer) {
        return;
      }

      map[clueKey] = sanitizedAnswer;
    });

    return map;
  }

  function requestExternalHtml(url) {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error('Extension messaging is unavailable.'));
        return;
      }

      chrome.runtime.sendMessage({ type: MESSAGE_TYPE_FETCH, url }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok || typeof response.text !== 'string') {
          reject(new Error(response?.error || 'External fetch failed.'));
          return;
        }

        resolve(response.text);
      });
    });
  }

  function hasEntries(map) {
    return !!map && Object.keys(map).length > 0;
  }

  function showFallbackNotice(message) {
    let banner = document.getElementById(FALLBACK_NOTICE_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = FALLBACK_NOTICE_ID;
      banner.style.position = 'sticky';
      banner.style.top = '0';
      banner.style.zIndex = '9999';
      banner.style.background = '#172554';
      banner.style.color = '#fff';
      banner.style.padding = '10px 16px';
      banner.style.fontSize = '0.95rem';
      banner.style.fontWeight = '600';
      banner.style.fontFamily = 'NYTFranklin, Helvetica, Arial, sans-serif';
      banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';

      const container =
        document.querySelector('.xwd__clue-list--wrapper') ||
        document.querySelector('[data-test="clue-list"]') ||
        document.querySelector('[data-test="clue-list-container"]') ||
        document.body;

      container.prepend(banner);
    }

    banner.textContent = message;
  }

  function enhanceClues(answerMap) {
    annotateExistingClues(answerMap);

    const observer = new MutationObserver(() => annotateExistingClues(answerMap));
    observer.observe(document.body, { subtree: true, childList: true });
  }

  function annotateExistingClues(answerMap) {
    const clueElements = document.querySelectorAll(CLUE_ITEM_SELECTOR);
    console.debug(`[NYT Answer Helper] Found ${clueElements.length} clue elements.`);

    clueElements.forEach((clueElement, index) => {
      if (clueElement.dataset[LISTENER_FLAG] === 'true') {
        return;
      }

      const clueKey = deriveClueKey(clueElement);
      console.debug(
        `[NYT Answer Helper] Processing clue ${index + 1}: derived key ${clueKey || 'N/A'}.`
      );

      if (!clueKey) {
        return;
      }

      const answer = answerMap[clueKey];
      if (!answer) {
        console.debug(
          `[NYT Answer Helper] No answer resolved for ${clueKey}. Available keys: ${Object.keys(
            answerMap
          ).length}.`
        );
      }

      if (!answer) {
        return;
      }

      clueElement.dataset[LISTENER_FLAG] = 'true';
      attachClueListener(clueElement, clueKey, answer);
    });
  }

  function deriveClueKey(clueElement) {
    const explicitKey =
      clueElement.getAttribute('data-clue') ||
      clueElement.getAttribute('data-clue-number') ||
      clueElement.dataset?.clueId;

    if (explicitKey) {
      return normalizeLabel(explicitKey, clueElement);
    }

    const labelNode = clueElement.querySelector(CLUE_LABEL_SELECTOR);
    if (!labelNode) {
      return null;
    }

    const labelText = labelNode.textContent || '';
    return normalizeLabel(labelText, clueElement);
  }

  function normalizeLabel(label, clueElement) {
    if (!label) {
      return null;
    }

    let sanitized = label.toString().trim().toUpperCase();
    sanitized = sanitized.replace(/\s+/g, '');

    // If it already ends with a direction letter (e.g., "17A", "42D"), use as-is.
    if (/^\d+[AD]$/.test(sanitized)) {
      return sanitized;
    }

    const suffix = inferDirection(clueElement);
    return `${sanitized}${suffix}`;
  }

  function inferDirection(clueElement) {
    if (!clueElement) {
      return 'A';
    }

    // Strategy 1: Check data-direction attributes (backward compat).
    const dirAttr =
      clueElement.getAttribute('data-direction') ||
      clueElement.dataset?.direction ||
      clueElement.closest('[data-direction]')?.getAttribute('data-direction');
    if (dirAttr) {
      return dirAttr.toLowerCase().startsWith('d') ? 'D' : 'A';
    }

    // Strategy 2: Walk up to .xwd__clue-list--wrapper and read section title.
    const wrapper = clueElement.closest('.xwd__clue-list--wrapper, [class*="ClueList"]');
    if (wrapper) {
      const title = wrapper.querySelector('.xwd__clue-list--title, [class*="ClueList-title"]');
      if (title && /down/i.test(title.textContent)) {
        return 'D';
      }
      if (title) {
        return 'A';
      }
    }

    // Strategy 3: Walk up looking for any heading/label containing "down" or "across".
    let parent = clueElement.parentElement;
    while (parent && parent !== document.body) {
      const heading = parent.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]');
      if (heading) {
        if (/down/i.test(heading.textContent)) {
          return 'D';
        }
        if (/across/i.test(heading.textContent)) {
          return 'A';
        }
      }
      parent = parent.parentElement;
    }

    return 'A';
  }

  function showAnswerPanel({ clueKey, rawAnswer, clueTitle }) {
    const panel = ensureAnswerPanel();
    const formatted = formatAnswer(rawAnswer);

    panel.querySelector('[data-role="clue-key"]').textContent = clueKey;
    panel.querySelector('[data-role="clue-text"]').textContent = clueTitle || '';
    panel.querySelector('[data-role="answer-text"]').textContent = formatted;

    panel.setAttribute(PANEL_ANSWER_ATTR, clueKey);
    panel.setAttribute(PANEL_VISIBLE_ATTR, 'true');
  }

  function hideAnswerPanel() {
    if (answerPanel) {
      answerPanel.setAttribute(PANEL_VISIBLE_ATTR, 'false');
    }
  }

  function ensureAnswerPanel(force = false) {
    if (!answerPanel || force) {
      if (answerPanel && answerPanel.parentElement) {
        answerPanel.parentElement.removeChild(answerPanel);
      }

      answerPanel = document.createElement('section');
      answerPanel.id = PANEL_ID;
      answerPanel.setAttribute('role', 'dialog');
      answerPanel.setAttribute('aria-live', 'polite');
      answerPanel.innerHTML = `
        <header class="nytcs-panel-header">
          <div>
            <p class="nytcs-panel-clue">
              <span data-role="clue-key"></span>
              <span data-role="clue-text"></span>
            </p>
            <p class="nytcs-panel-cta">Click another clue to update, or press Esc to hide.</p>
          </div>
          <button type="button" class="nytcs-panel-close" aria-label="Hide answer panel">&times;</button>
        </header>
        <div class="nytcs-panel-body">
          <span class="nytcs-panel-answer" data-role="answer-text"></span>
        </div>
      `;

      answerPanel.querySelector('.nytcs-panel-close').addEventListener('click', hideAnswerPanel);

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          hideAnswerPanel();
        }
      });

      document.body.appendChild(answerPanel);
      console.debug('[NYT Answer Helper] Answer panel created/updated.');
    }

    return answerPanel;
  }

  function formatAnswer(answer) {
    return answer.trim();
  }

  function attachClueListener(clueElement, clueKey, rawAnswer) {
    console.debug(`[NYT Answer Helper] Attaching listener for ${clueKey}.`);

    const handler = () => {
      // Extract just the clue text (not the number) for a cleaner title.
      const textNode = clueElement.querySelector(CLUE_TEXT_SELECTOR);
      const clueTitle = textNode?.textContent?.trim() || clueElement.textContent?.trim() || '';

      console.debug(`[NYT Answer Helper] Showing answer panel for ${clueKey}.`);
      showAnswerPanel({
        clueKey,
        rawAnswer,
        clueTitle,
      });
    };

    // Don't preventDefault/stopPropagation — let NYT handle the click normally
    // (selecting the clue in the grid) while we also show the answer panel.
    clueElement.addEventListener('click', handler, { capture: false });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 24px;
        bottom: 24px;
        width: min(360px, calc(100vw - 32px));
        background: #0b1228;
        color: #ffffff;
        border-radius: 14px;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
        padding: 18px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-family: 'NYTFranklin', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        opacity: 0;
        transform: translateY(12px);
        transition: opacity 140ms ease, transform 140ms ease;
        z-index: 2147483647;
      }

      #${PANEL_ID}[${PANEL_VISIBLE_ATTR}="true"] {
        opacity: 1;
        transform: translateY(0);
      }

      #${PANEL_ID} .nytcs-panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      #${PANEL_ID} .nytcs-panel-clue {
        font-size: 0.95rem;
        margin: 0;
        color: rgba(255, 255, 255, 0.85);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      #${PANEL_ID} .nytcs-panel-cta {
        font-size: 0.75rem;
        margin: 2px 0 0;
        color: rgba(255, 255, 255, 0.6);
      }

      #${PANEL_ID} .nytcs-panel-body {
        margin-top: 18px;
        font-size: 1.8rem;
        letter-spacing: 0.18em;
        font-weight: 700;
        overflow-wrap: anywhere;
      }

      #${PANEL_ID} .nytcs-panel-answer {
        font-feature-settings: 'tnum';
      }

      #${PANEL_ID} .nytcs-panel-close {
        border: none;
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        width: 30px;
        height: 30px;
        border-radius: 999px;
        font-size: 1.2rem;
        cursor: pointer;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 120ms ease, transform 120ms ease;
      }

      #${PANEL_ID} .nytcs-panel-close:hover {
        background: rgba(255, 255, 255, 0.24);
        transform: scale(1.05);
      }

      #${PANEL_ID} [data-role="clue-key"] {
        font-weight: 700;
        margin-right: 6px;
      }

      #${PANEL_ID} [data-role="clue-text"] {
        font-weight: 400;
      }
    `;

    document.head.appendChild(style);
  }
})();

