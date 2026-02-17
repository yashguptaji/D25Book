(function () {
  const input = document.getElementById('profile_image');
  const hidden = document.getElementById('croppedImageData');
  const dialog = document.getElementById('cropDialog');
  const canvas = document.getElementById('cropCanvas');
  const zoomInput = document.getElementById('cropZoom');
  const cancelBtn = document.getElementById('cropCancel');
  const saveBtn = document.getElementById('cropSave');

  if (!input || !hidden || !dialog || !canvas || !zoomInput || !cancelBtn || !saveBtn) return;

  const ctx = canvas.getContext('2d');
  const cropSize = 260;
  let image = null;
  let baseScale = 1;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function cropRect() {
    return {
      x: (canvas.width - cropSize) / 2,
      y: (canvas.height - cropSize) / 2,
      size: cropSize
    };
  }

  function clampOffsets() {
    if (!image) return;
    const scale = baseScale * zoom;
    const dw = image.width * scale;
    const dh = image.height * scale;
    const rect = cropRect();

    const minX = rect.x + rect.size - dw;
    const maxX = rect.x;
    const minY = rect.y + rect.size - dh;
    const maxY = rect.y;

    offsetX = Math.min(maxX, Math.max(minX, offsetX));
    offsetY = Math.min(maxY, Math.max(minY, offsetY));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a120d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!image) return;

    const scale = baseScale * zoom;
    const dw = image.width * scale;
    const dh = image.height * scale;

    ctx.drawImage(image, offsetX, offsetY, dw, dh);

    const rect = cropRect();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, rect.y);
    ctx.fillRect(0, rect.y, rect.x, rect.size);
    ctx.fillRect(rect.x + rect.size, rect.y, canvas.width - rect.x - rect.size, rect.size);
    ctx.fillRect(0, rect.y + rect.size, canvas.width, canvas.height - rect.y - rect.size);

    ctx.strokeStyle = '#f4d7aa';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.size, rect.size);
  }

  function openCropper(file) {
    hidden.value = '';
    const reader = new FileReader();
    reader.onload = function (event) {
      const img = new Image();
      img.onload = function () {
        image = img;
        const rect = cropRect();
        baseScale = Math.max(rect.size / image.width, rect.size / image.height);
        zoom = 1;
        zoomInput.value = '1';
        offsetX = (canvas.width - image.width * baseScale) / 2;
        offsetY = (canvas.height - image.height * baseScale) / 2;
        clampOffsets();
        draw();
        dialog.showModal();
      };
      img.src = String(event.target.result || '');
    };
    reader.readAsDataURL(file);
  }

  zoomInput.addEventListener('input', function () {
    zoom = Number(zoomInput.value) || 1;
    clampOffsets();
    draw();
  });

  canvas.addEventListener('mousedown', function (event) {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  window.addEventListener('mouseup', function () {
    dragging = false;
  });

  canvas.addEventListener('mousemove', function (event) {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    offsetX += dx;
    offsetY += dy;
    clampOffsets();
    draw();
  });

  cancelBtn.addEventListener('click', function () {
    dialog.close();
    input.value = '';
    hidden.value = '';
  });

  saveBtn.addEventListener('click', function () {
    const rect = cropRect();
    const out = document.createElement('canvas');
    out.width = 256;
    out.height = 256;
    const outCtx = out.getContext('2d');

    const scale = baseScale * zoom;
    const sx = (rect.x - offsetX) / scale;
    const sy = (rect.y - offsetY) / scale;
    const sSize = rect.size / scale;

    outCtx.drawImage(image, sx, sy, sSize, sSize, 0, 0, out.width, out.height);
    hidden.value = out.toDataURL('image/jpeg', 0.9);
    dialog.close();
    input.value = '';
  });

  input.addEventListener('change', function () {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      input.value = '';
      return;
    }
    openCropper(file);
  });
})();
