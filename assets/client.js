// Keep a small window of neighboring files mounted while scrolling through the report.
(() => {
  document.addEventListener(
    'error',
    (event) => {
      if (event.target.matches?.('img.material-icon')) event.target.classList.add('icon-failed');
    },
    true
  );
  const $ = (id) => document.getElementById(id);
  const divider = $('sidebar-resize');
  const navigator = document.querySelector('.navigator');
  const maxSidebarWidth = () => Math.max(190, Math.min(480, innerWidth - 420));
  function sidebarWidth(width, persist = true) {
    width = Math.round(Math.max(190, Math.min(maxSidebarWidth(), width)));
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    divider.setAttribute('aria-valuenow', String(width));
    divider.setAttribute('aria-valuemax', String(maxSidebarWidth()));
    if (persist) {
      try {
        localStorage.setItem('tests-diet-sidebar-width', String(width));
      } catch {}
    }
  }
  let resizeStart;
  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    resizeStart = { x: event.clientX, width: navigator.getBoundingClientRect().width };
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-sidebar');
  });
  divider.addEventListener('pointermove', (event) => {
    if (resizeStart) sidebarWidth(resizeStart.width + event.clientX - resizeStart.x, false);
  });
  divider.addEventListener('lostpointercapture', () => {
    if (!resizeStart) return;
    resizeStart = undefined;
    document.body.classList.remove('resizing-sidebar');
    sidebarWidth(navigator.getBoundingClientRect().width);
  });
  divider.addEventListener('keydown', (event) => {
    const width = navigator.getBoundingClientRect().width;
    const values = {
      ArrowLeft: width - 12,
      ArrowRight: width + 12,
      Home: 190,
      End: maxSidebarWidth()
    };
    if (event.key in values) {
      event.preventDefault();
      sidebarWidth(values[event.key]);
    }
  });
  divider.addEventListener('dblclick', () => {
    document.documentElement.style.removeProperty('--sidebar-width');
    try {
      localStorage.removeItem('tests-diet-sidebar-width');
    } catch {}
  });
  new ResizeObserver(() => {
    if (innerWidth <= 700) return;
    divider.setAttribute(
      'aria-valuenow',
      String(Math.round(navigator.getBoundingClientRect().width))
    );
    divider.setAttribute('aria-valuemax', String(maxSidebarWidth()));
  }).observe(navigator);
  const explanations = {
    costly:
      'Would a bug in the production behavior this test protects cause meaningful harm, such as lost money, data loss, a security breach, or a broken external contract? This is not the cost of removing or maintaining the test.',
    silent:
      'Would a bug in that production behavior go unnoticed by types, other tests, and normal use? Yes means this test may catch a regression that would otherwise stay hidden.',
    likely:
      'Is the production logic likely to regress because it is complex, changes often, or has broken before? This describes the code being tested, not whether the test itself is flaky.',
    cheap:
      'Is this test fast and inexpensive to maintain relative to what it protects? Consider execution time, setup, fixtures, and test size. This is the cost of keeping the test, not deleting it.'
  };
  const tooltip = $('value-tooltip');
  let tooltipTrigger;
  let tooltipCloseTimer;
  function hideValueHelp() {
    clearTimeout(tooltipCloseTimer);
    tooltip.hidden = true;
    tooltipTrigger?.removeAttribute('aria-describedby');
    tooltipTrigger = undefined;
  }
  function showValueHelp(trigger) {
    if (!trigger) return;
    hideValueHelp();
    tooltipTrigger = trigger;
    const yes = trigger.closest('[data-yes]').dataset.yes === 'true';
    tooltip.textContent = `${explanations[trigger.dataset.assessment]} This finding: ${yes ? 'Yes' : 'No'}. A Yes supports keeping the test; it does not decide the recommendation on its own.`;
    tooltip.hidden = false;
    trigger.setAttribute('aria-describedby', 'value-tooltip');
    const rect = trigger.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - box.width - 12))}px`;
    tooltip.style.top = `${Math.max(12, rect.bottom + box.height + 8 < innerHeight ? rect.bottom + 6 : rect.top - box.height - 6)}px`;
  }
  for (const type of ['pointerover', 'focusin', 'click'])
    document.addEventListener(type, (event) => {
      if (tooltip.contains(event.target)) clearTimeout(tooltipCloseTimer);
      const trigger = event.target.closest('.value-help');
      if (trigger) showValueHelp(trigger);
    });
  document.addEventListener('pointerout', (event) => {
    if (!tooltipTrigger) return;
    const next = event.relatedTarget;
    if (next && (tooltip.contains(next) || tooltipTrigger.contains(next))) return;
    if (
      (tooltipTrigger.contains(event.target) || tooltip.contains(event.target)) &&
      document.activeElement !== tooltipTrigger
    )
      tooltipCloseTimer = setTimeout(hideValueHelp, 120);
  });
  document.addEventListener('focusout', (event) => {
    if (event.target === tooltipTrigger) hideValueHelp();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.value-help') && !tooltip.contains(event.target)) hideValueHelp();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideValueHelp();
  });
  document.addEventListener(
    'scroll',
    () => {
      if (tooltipTrigger && document.activeElement === tooltipTrigger) {
        const rect = tooltipTrigger.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < innerHeight) showValueHelp(tooltipTrigger);
        else hideValueHelp();
      } else hideValueHelp();
    },
    true
  );
  window.addEventListener('resize', hideValueHelp);
  const preference = matchMedia('(prefers-color-scheme: light)');
  let chosenTheme;
  try {
    chosenTheme = localStorage.getItem('tests-diet-theme');
  } catch {}
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const label = theme === 'dark' ? 'Light mode' : 'Dark mode';
    $('theme-toggle').textContent = label;
    $('theme-toggle').setAttribute('aria-label', `Switch to ${label.toLowerCase()}`);
  }
  applyTheme(
    chosenTheme === 'light' || chosenTheme === 'dark'
      ? chosenTheme
      : preference.matches
        ? 'light'
        : 'dark'
  );
  $('theme-toggle').addEventListener('click', () => {
    chosenTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(chosenTheme);
    try {
      localStorage.setItem('tests-diet-theme', chosenTheme);
    } catch {}
  });
  preference.addEventListener('change', () => {
    if (!chosenTheme) applyTheme(preference.matches ? 'light' : 'dark');
  });
  const records = [...document.querySelectorAll('[data-record]')].map((el) => ({
    el,
    path: el.dataset.path,
    verdict: el.dataset.verdict,
    lines: Number(el.dataset.lines),
    findings: JSON.parse(el.dataset.findings),
    template: el.querySelector('template')
  }));
  const links = [...document.querySelectorAll('[data-file]')];
  const treeOrder = new Map(
    [...$('tree').querySelectorAll('[data-file]')].map((el, index) => [
      Number(el.dataset.file),
      index
    ])
  );
  const directories = [...document.querySelectorAll('.directory')].reverse();
  const directoryFiles = new Map(
    directories.map((dir) => [
      dir,
      [...dir.querySelectorAll('[data-file]')].map((link) => Number(link.dataset.file))
    ])
  );
  let action = 'nonkeep';
  let view = 'tree';
  let selected = -1;
  let visible = [];
  let matches = [];
  let timer;
  const scroller = $('review-scroll');
  const content = $('file-content');
  let firstPosition = -1;
  let lastPosition = -1;
  let scrollFrame;
  let alignedScrollTop = null;
  const confidenceLevels = ['very_low', 'low', 'medium', 'high', 'very_high'];
  const viewedKey = `tests-diet-viewed:${location.pathname}:${$('report-files').dataset.generatedAt}`;
  let viewed = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(viewedKey) ?? '[]');
    if (Array.isArray(saved)) viewed = new Set(saved.filter((path) => typeof path === 'string'));
  } catch {}
  function showViewed(index) {
    for (const link of links) {
      if (Number(link.dataset.file) === index) link.querySelector('.viewed-marker').hidden = false;
    }
    for (const article of content.children) {
      if (Number(article.dataset.fileView) === index)
        article.querySelector('.viewed-label').hidden = false;
    }
  }
  records.forEach((record, index) => {
    if (viewed.has(record.path)) showViewed(index);
  });
  const headingSizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target.isConnected)
        entry.target
          .closest('.file-review')
          .style.setProperty(
            '--file-header-height',
            `${entry.target.getBoundingClientRect().height}px`
          );
    }
  });
  const viewedObserver = new IntersectionObserver(
    (entries) => {
      if (document.visibilityState !== 'visible') return;
      for (const entry of entries) {
        if (!entry.target.isConnected || !entry.isIntersecting || entry.intersectionRatio < 0.5)
          continue;
        const index = Number(entry.target.closest('.file-review').dataset.fileView);
        const path = records[index].path;
        if (!viewed.has(path)) {
          viewed.add(path);
          showViewed(index);
          try {
            localStorage.setItem(viewedKey, JSON.stringify([...viewed]));
          } catch {}
        }
      }
    },
    { root: scroller, threshold: 0.5 }
  );
  function unobserveArticle(article) {
    const heading = article.querySelector('.file-heading');
    viewedObserver.unobserve(heading);
    headingSizes.unobserve(heading);
  }

  function filters() {
    return {
      q: $('q').value.trim().toLowerCase(),
      category: $('category').value,
      confidence: $('confidence').value,
      verdict: $('verdict').value
    };
  }
  function match(finding, file, filter) {
    return (
      (!action || (action === 'nonkeep' ? finding.action !== 'keep' : finding.action === action)) &&
      (!filter.category || finding.category === filter.category) &&
      (!filter.confidence || finding.confidence === filter.confidence) &&
      (!filter.q ||
        file.path.toLowerCase().includes(filter.q) ||
        finding.test.toLowerCase().includes(filter.q))
    );
  }
  function pathOrder(a, b) {
    return records[a].path < records[b].path ? -1 : records[a].path > records[b].path ? 1 : 0;
  }
  function sortVisible() {
    const sort = view === 'list' ? $('sort').value : 'path';
    const ranks =
      sort === 'confidence'
        ? records.map((file, index) =>
            matches[index].reduce(
              (best, i) => Math.max(best, confidenceLevels.indexOf(file.findings[i].confidence)),
              -1
            )
          )
        : [];
    visible.sort((a, b) =>
      view === 'tree'
        ? treeOrder.get(a) - treeOrder.get(b)
        : (sort === 'lines'
            ? records[b].lines - records[a].lines
            : sort === 'confidence'
              ? ranks[b] - ranks[a]
              : 0) || pathOrder(a, b)
    );
    if (view === 'list') {
      const nodes = new Map([...$('list').children].map((el) => [Number(el.dataset.file), el]));
      const fragment = document.createDocumentFragment();
      for (const index of visible) fragment.append(nodes.get(index));
      $('list').prepend(fragment);
    }
  }
  function updateToolbar() {
    const position = visible.indexOf(selected);
    $('position').textContent =
      position < 0 ? 'No file selected' : `${position + 1} of ${visible.length} files`;
    $('previous').disabled = position <= 0;
    $('next').disabled = position < 0 || position >= visible.length - 1;
  }
  function updateFindings(article, index) {
    const indices = new Set(matches[index]);
    for (const el of article.querySelectorAll('[data-finding]'))
      el.hidden = !indices.has(Number(el.dataset.finding));
    for (const group of article.querySelectorAll('.merge-group'))
      group.hidden = !group.querySelector('[data-finding]:not([hidden])');
    article.querySelector('.finding-count').textContent =
      `${indices.size} of ${records[index].findings.length} shown`;
  }
  function highlightSources() {
    if (!window.hljs) return;
    for (const code of $('file-content').querySelectorAll(
      '.finding:not([hidden]) code[data-language]'
    )) {
      if (code.dataset.highlighted || !window.hljs.getLanguage(code.dataset.language)) continue;
      // Highlight the whole excerpt so multiline strings and comments retain their context.
      const source = code.textContent;
      try {
        code.innerHTML = window.hljs.highlight(source, {
          language: code.dataset.language,
          ignoreIllegals: true
        }).value;
        code.dataset.highlighted = 'true';
      } catch {
        code.textContent = source;
      }
    }
  }
  function revealNavigation(scroll = false) {
    const active = $(view).querySelector('[aria-current="true"]');
    if (!active) return;
    for (
      let parent = active.closest('.directory');
      parent;
      parent = parent.parentElement.closest('.directory')
    )
      parent.open = true;
    if (scroll) {
      // Scroll only the navigator, never the outer page or the review pane.
      const pane = document.querySelector('.file-scroll');
      const bounds = pane.getBoundingClientRect();
      const row = active.getBoundingClientRect();
      if (row.top < bounds.top) pane.scrollTop += row.top - bounds.top - 8;
      else if (row.bottom > bounds.bottom) pane.scrollTop += row.bottom - bounds.bottom + 8;
    }
  }
  function setActive(index, hash = true) {
    selected = index;
    for (const link of links) {
      if (Number(link.dataset.file) === index) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    updateToolbar();
    if (hash && index >= 0) {
      try {
        history.replaceState(null, '', `#file=${encodeURIComponent(records[index].path)}`);
      } catch {
        /* Sandboxed file viewers may disallow history. */
      }
    }
    revealNavigation(true);
  }
  function mountFile(position, prepend = false) {
    const index = visible[position];
    const article = records[index].template.content.firstElementChild.cloneNode(true);
    article.dataset.fileView = index;
    updateFindings(article, index);
    if (prepend) content.prepend(article);
    else content.append(article);
    article.querySelector('.viewed-label').hidden = !viewed.has(records[index].path);
    const heading = article.querySelector('.file-heading');
    article.style.setProperty(
      '--file-header-height',
      `${heading.getBoundingClientRect().height}px`
    );
    headingSizes.observe(heading);
    viewedObserver.observe(heading);
    return article;
  }
  function select(index, { reveal = false, hash = true } = {}) {
    if (reveal) document.body.classList.add('show-review');
    cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    headingSizes.disconnect();
    viewedObserver.disconnect();
    content.replaceChildren();
    $('empty').hidden = index >= 0;
    content.hidden = index < 0;
    firstPosition = lastPosition = visible.indexOf(index);
    if (index >= 0) {
      const target = mountFile(firstPosition);
      if (firstPosition > 0) mountFile(--firstPosition, true);
      if (lastPosition < visible.length - 1) mountFile(++lastPosition);
      // Filters can leave tiny articles: fill the viewport before relying on scroll events.
      while (
        scroller.clientHeight &&
        target.getBoundingClientRect().top -
          content.getBoundingClientRect().top +
          scroller.clientHeight >=
          content.scrollHeight &&
        lastPosition < visible.length - 1
      )
        mountFile(++lastPosition);
      highlightSources();
      scroller.scrollTop +=
        target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      alignedScrollTop = scroller.scrollTop;
    }
    setActive(index, hash);
    if (reveal) {
      if (matchMedia('(max-width: 700px)').matches) $('review').focus({ preventScroll: true });
    }
  }
  function followScroll() {
    scrollFrame = undefined;
    if (selected < 0 || !scroller.clientHeight) return;
    if (alignedScrollTop !== null) {
      const aligned = Math.abs(scroller.scrollTop - alignedScrollTop) < 1;
      alignedScrollTop = null;
      if (aligned) return;
    }
    const bounds = scroller.getBoundingClientRect();
    const anchor = content.firstElementChild;
    const anchorTop = anchor.getBoundingClientRect().top;
    let extended = false;
    if (
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 600 &&
      lastPosition < visible.length - 1
    ) {
      mountFile(++lastPosition);
      extended = true;
    } else if (scroller.scrollTop < 300 && firstPosition > 0) {
      mountFile(--firstPosition, true);
      extended = true;
    }
    if (extended) {
      highlightSources();
      scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    }
    // Remove only files already outside the viewport, preserving the reader's position.
    while (content.children.length > 7) {
      const first = content.firstElementChild;
      const last = content.lastElementChild;
      if (first.getBoundingClientRect().bottom < bounds.top) {
        const next = first.nextElementSibling;
        const top = next.getBoundingClientRect().top;
        unobserveArticle(first);
        first.remove();
        firstPosition++;
        scroller.scrollTop += next.getBoundingClientRect().top - top;
      } else if (last.getBoundingClientRect().top > bounds.bottom) {
        unobserveArticle(last);
        last.remove();
        lastPosition--;
      } else break;
    }
    let active = content.firstElementChild;
    for (const article of content.children) {
      if (article.getBoundingClientRect().top <= bounds.top + 2) active = article;
      else break;
    }
    if (
      lastPosition === visible.length - 1 &&
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2
    )
      active = content.lastElementChild;
    const index = Number(active.dataset.fileView);
    if (index !== selected) setActive(index);
  }
  scroller.addEventListener(
    'scroll',
    () => {
      if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(followScroll);
    },
    { passive: true }
  );
  function render() {
    clearTimeout(timer);
    const filter = filters();
    matches = records.map((file) =>
      file.findings.flatMap((finding, index) => (match(finding, file, filter) ? [index] : []))
    );
    visible = records.flatMap((file, index) => {
      const emptyFile =
        !file.findings.length &&
        (!action || action === 'keep') &&
        !filter.category &&
        !filter.confidence &&
        (!filter.q || file.path.toLowerCase().includes(filter.q));
      return (!filter.verdict || file.verdict === filter.verdict) &&
        (matches[index].length || emptyFile)
        ? [index]
        : [];
    });
    const shown = new Set(visible);
    for (const link of links) link.hidden = !shown.has(Number(link.dataset.file));
    for (const dir of directories) {
      const count = directoryFiles.get(dir).filter((index) => shown.has(index)).length;
      dir.hidden = !count;
      dir.querySelector(':scope > summary .directory-count').textContent = count;
      if (count && (filter.q || filter.category || filter.confidence || filter.verdict))
        dir.open = true;
    }
    sortVisible();
    $('file-count').textContent = `${visible.length} / ${records.length} files`;
    $('nav-empty').hidden = visible.length > 0;
    $('nav-empty').textContent = records.length
      ? 'No matching files. Try another action or adjust the filters.'
      : 'No files analyzed yet. Generate the report after an analysis run.';
    const count = [filter.category, filter.confidence, filter.verdict].filter(Boolean).length;
    $('filter-count').textContent = count ? `(${count})` : '';
    for (const button of document.querySelectorAll('button[data-action]'))
      button.setAttribute('aria-pressed', String(button.dataset.action === action));
    select(shown.has(selected) ? selected : (visible[0] ?? -1));
  }
  function reset(all = false) {
    for (const id of ['q', 'category', 'confidence', 'verdict']) $(id).value = '';
    if (all) action = '';
    render();
  }
  function move(offset) {
    const index = visible.indexOf(selected) + offset;
    if (index >= 0 && index < visible.length) select(visible[index], { reveal: true });
  }
  for (const link of links)
    link.addEventListener('click', () => select(Number(link.dataset.file), { reveal: true }));
  for (const button of document.querySelectorAll('button[data-action]'))
    button.addEventListener('click', () => {
      action = button.dataset.action;
      render();
    });
  for (const button of document.querySelectorAll('button[data-view]'))
    button.addEventListener('click', () => {
      view = button.dataset.view;
      $('tree').hidden = view !== 'tree';
      $('list').hidden = view !== 'list';
      $('sort-control').hidden = view !== 'list';
      $('tree-controls').hidden = view !== 'tree';
      for (const item of document.querySelectorAll('button[data-view]'))
        item.setAttribute('aria-pressed', String(item === button));
      sortVisible();
      select(selected);
    });
  $('q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 100);
  });
  for (const id of ['category', 'confidence', 'verdict']) $(id).addEventListener('change', render);
  $('sort').addEventListener('change', () => {
    sortVisible();
    select(selected);
  });
  $('expand-tree').addEventListener('click', () => {
    for (const directory of directories) if (!directory.hidden) directory.open = true;
    revealNavigation(true);
  });
  $('collapse-tree').addEventListener('click', () => {
    for (const directory of directories) directory.open = false;
  });
  $('reset-filters').addEventListener('click', () => reset());
  $('show-deletions').addEventListener('click', () => {
    for (const id of ['q', 'category', 'confidence']) $(id).value = '';
    $('verdict').value = 'delete_file';
    action = 'delete';
    render();
  });
  $('clear-all')?.addEventListener('click', () => reset(true));
  $('previous').addEventListener('click', () => move(-1));
  $('next').addEventListener('click', () => move(1));
  $('show-files').addEventListener('click', () => {
    document.body.classList.remove('show-review');
    revealNavigation(true);
    $('q').focus();
  });
  document.querySelector('.skip-link').addEventListener('click', () => {
    document.body.classList.add('show-review');
  });
  $('open-run').addEventListener('click', () => $('run-dialog').showModal());
  $('close-run').addEventListener('click', () => $('run-dialog').close());
  $('run-dialog').addEventListener('click', (event) => {
    if (event.target === $('run-dialog')) {
      const rect = event.target.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        event.target.close();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      $('run-dialog').open ||
      event.target.closest('input, select, textarea, [contenteditable="true"]')
    )
      return;
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      document.body.classList.remove('show-review');
      $('q').focus();
    }
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    }
  });
  function fromHash(hash = location.hash) {
    if (!hash.startsWith('#file=')) return false;
    const params = new URLSearchParams(hash.slice(1));
    const path = params.get('file');
    const index = records.findIndex((file) => file.path === path);
    if (index < 0) return false;
    const line = Number(params.get('test'));
    const finding =
      line > 0 ? records[index].findings.findIndex((item) => item.startLine === line) : -1;
    if (!visible.includes(index) || (finding >= 0 && !matches[index].includes(finding)))
      reset(true);
    select(index, { reveal: true, hash: false });
    if (finding >= 0) {
      const article = [...content.children].find((el) => Number(el.dataset.fileView) === index);
      const target = [...article.querySelectorAll('[data-finding]')].find(
        (el) => Number(el.dataset.finding) === finding
      );
      const headerHeight = article.querySelector('.file-heading').getBoundingClientRect().height;
      scroller.scrollTop +=
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        headerHeight -
        12;
      alignedScrollTop = scroller.scrollTop;
    }
    try {
      history.replaceState(null, '', hash);
    } catch {}
    return true;
  }
  content.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-review-anchor]');
    if (
      !link ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const hash = link.getAttribute('href');
    if (location.hash !== hash) {
      try {
        history.pushState(null, '', hash);
      } catch {}
    }
    fromHash(hash);
  });
  const initialHash = location.hash;
  render();
  if (initialHash.startsWith('#file=')) {
    try {
      history.replaceState(null, '', initialHash);
    } catch {}
    fromHash();
  }
  window.addEventListener('hashchange', () => fromHash());
  const highlighter = document.createElement('script');
  highlighter.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js';
  highlighter.integrity = 'sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU';
  highlighter.crossOrigin = 'anonymous';
  highlighter.referrerPolicy = 'no-referrer';
  highlighter.addEventListener('load', highlightSources);
  document.head.append(highlighter);
})();
