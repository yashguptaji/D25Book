(function () {
  const stage = document.getElementById('showcaseStage');
  const progress = document.getElementById('showcaseProgress');
  const nextBtn = document.getElementById('nextEntryBtn');
  const skipBtn = document.getElementById('skipToCollageBtn');
  const collageSection = document.getElementById('collageSection');
  const collagePreview = document.getElementById('collagePreview');
  const downloadBtn = document.getElementById('downloadCollageBtn');
  const restartBtn = document.getElementById('restartShowcaseBtn');

  if (!stage || !progress || !nextBtn || !skipBtn || !collageSection || !collagePreview || !downloadBtn || !restartBtn) return;

  const originalEntries = Array.isArray(window.__SHOWCASE_ENTRIES) ? window.__SHOWCASE_ENTRIES.slice() : [];

  function shuffle(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  let entries = shuffle(originalEntries);
  let idx = 0;

  function esc(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderEntry(entry) {
    if (!entry) {
      stage.innerHTML = '<div class="showcase-entry"><h2>No posts yet</h2><p class="muted">Once posts arrive, they will appear here.</p></div>';
      progress.textContent = '';
      return;
    }

    progress.textContent = `Post ${idx + 1} of ${entries.length}`;

    let body = '';
    if (entry.type === 'text') {
      body = `<p class="showcase-text">${esc(entry.text_content || '')}</p>`;
    } else if (entry.type === 'image') {
      body = `<img class="showcase-image" src="/${esc(entry.file_path)}" alt="Shared image" />`;
    } else if (entry.type === 'audio') {
      body = `
        <div class="showcase-audio-wrap">
          <p class="muted">Audio memory</p>
          <audio controls class="entry-audio">
            <source src="/${esc(entry.file_path)}" type="${esc(entry.mime_type || '')}" />
          </audio>
        </div>
      `;
    }

    stage.innerHTML = `
      <article class="showcase-entry">
        <div class="showcase-meta">
          <strong>${esc(entry.author_name || 'Someone')}</strong>
          <span>${new Date(entry.created_at).toLocaleString()}</span>
          <span class="pill">${esc(entry.type || 'text')}</span>
        </div>
        ${body}
      </article>
    `;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let current = '';

    words.forEach((word) => {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);

    lines.slice(0, maxLines).forEach((line, i) => {
      ctx.fillText(line, x, y + i * lineHeight);
    });
  }

  function computeMasonryLayout(count, canvasWidth) {
    const pad = 30;
    const cols = 4;
    const colW = Math.floor((canvasWidth - pad * (cols + 1)) / cols);
    const heights = new Array(cols).fill(pad);
    const cards = [];

    for (let i = 0; i < count; i += 1) {
      const span = Math.random() < 0.3 ? 2 : 1;
      const safeSpan = span > cols ? 1 : span;

      let bestCol = 0;
      let bestY = Number.POSITIVE_INFINITY;

      for (let start = 0; start <= cols - safeSpan; start += 1) {
        let y = 0;
        for (let c = start; c < start + safeSpan; c += 1) {
          y = Math.max(y, heights[c]);
        }
        if (y < bestY) {
          bestY = y;
          bestCol = start;
        }
      }

      const width = colW * safeSpan + pad * (safeSpan - 1);
      const hFactors = [0.78, 0.95, 1.1, 1.28, 1.45];
      const factor = hFactors[Math.floor(Math.random() * hFactors.length)];
      const height = Math.floor(colW * factor + 80);
      const x = pad + bestCol * (colW + pad);
      const y = bestY;

      for (let c = bestCol; c < bestCol + safeSpan; c += 1) {
        heights[c] = y + height + pad;
      }

      cards.push({ x, y, width, height });
    }

    const totalHeight = Math.max(...heights) + pad;
    return { cards, totalHeight };
  }

  async function drawEntryCard(ctx, entry, box) {
    const { x, y, width, height } = box;

    ctx.save();
    ctx.shadowColor = 'rgba(20,10,3,0.2)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(255, 245, 230, 0.97)';
    ctx.fillRect(x, y, width, height);
    ctx.restore();

    ctx.strokeStyle = 'rgba(109, 72, 45, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = '#553620';
    ctx.font = 'bold 25px sans-serif';
    ctx.fillText(entry.author_name || 'Dormie', x + 16, y + 34);

    ctx.fillStyle = '#805739';
    ctx.font = '15px sans-serif';
    ctx.fillText((entry.type || 'text').toUpperCase(), x + 16, y + 58);

    const contentX = x + 16;
    const contentY = y + 70;
    const contentW = width - 32;
    const contentH = height - 86;

    if (entry.type === 'image' && entry.file_path) {
      const img = await loadImage(`/${entry.file_path}`);
      if (img) {
        const scale = Math.max(contentW / img.width, contentH / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const dx = contentX + (contentW - drawW) / 2;
        const dy = contentY + (contentH - drawH) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(contentX, contentY, contentW, contentH);
        ctx.clip();
        ctx.drawImage(img, dx, dy, drawW, drawH);
        ctx.restore();
      }
      return;
    }

    if (entry.type === 'audio') {
      ctx.fillStyle = '#7d522f';
      ctx.font = '58px serif';
      ctx.fillText('♫', contentX + contentW / 2 - 12, contentY + contentH / 2 - 5);
      ctx.fillStyle = '#6f4b31';
      ctx.font = '17px sans-serif';
      drawWrappedText(ctx, 'Audio memory from Dorm 25', contentX + 10, contentY + contentH - 22, contentW - 20, 22, 2);
      return;
    }

    ctx.fillStyle = '#563927';
    ctx.font = '20px sans-serif';
    drawWrappedText(ctx, entry.text_content || '', contentX, contentY + 8, contentW, 27, Math.max(3, Math.floor(contentH / 27) - 1));
  }

  async function buildCollage() {
    const width = 1960;
    const canvas = document.createElement('canvas');
    canvas.width = width;

    const layout = computeMasonryLayout(entries.length, width);
    canvas.height = Math.max(560, layout.totalHeight);

    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, width, canvas.height);
    grad.addColorStop(0, '#2a180f');
    grad.addColorStop(1, '#5b381f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, canvas.height);

    for (let i = 0; i < entries.length; i += 1) {
      await drawEntryCard(ctx, entries[i], layout.cards[i]);
    }

    ctx.fillStyle = 'rgba(252, 230, 197, 0.88)';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('Dorm 25 Scrapbook Collage', 38, canvas.height - 22);

    return canvas.toDataURL('image/png');
  }

  async function showCollage() {
    const url = await buildCollage();
    collagePreview.src = url;
    downloadBtn.href = url;
    collageSection.hidden = false;
    stage.parentElement.hidden = true;
  }

  function next() {
    if (!entries.length) return;
    idx += 1;
    if (idx >= entries.length) {
      showCollage();
      return;
    }
    renderEntry(entries[idx]);
  }

  nextBtn.addEventListener('click', next);
  skipBtn.addEventListener('click', showCollage);

  restartBtn.addEventListener('click', function () {
    entries = shuffle(originalEntries);
    idx = 0;
    collageSection.hidden = true;
    stage.parentElement.hidden = false;
    renderEntry(entries[idx]);
  });

  renderEntry(entries[idx]);
})();
