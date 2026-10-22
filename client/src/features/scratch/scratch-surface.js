// Draw in CSS pixels; the canvas transform alone applies the device-pixel ratio.
// Progress uses a tiny separate mask, never a synchronous full-size GPU readback.
export function createScratchSurface(canvas, { paint, onProgress, onComplete }) {
  const context = canvas.getContext("2d");
  const mask = document.createElement("canvas");
  mask.width = 128;
  mask.height = 80;
  const coverage = mask.getContext("2d", { willReadFrequently: true });
  let width = 0, height = 0, pointer = null, last = null, frame = 0;
  let pending = [], lastCheck = -Infinity, progress = 0, dirty = false, complete = false, disposed = false;
  const radius = 29;

  function reset() {
    if (disposed) return;
    complete = false;
    pending = [];
    dirty = false;
    last = null;
    pointer = null;
    coverage.setTransform(1, 0, 0, 1, 0, 0);
    coverage.globalCompositeOperation = "source-over";
    coverage.fillStyle = "#000";
    coverage.fillRect(0, 0, mask.width, mask.height);
    context.globalCompositeOperation = "source-over";
    paint(context, width, height);
    canvas.classList.remove("canvas-revealed");
    progress = 0;
    lastCheck = -Infinity;
    onProgress(0);
  }

  function resize() {
    if (disposed || complete) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.round(rect.width * ratio), nextHeight = Math.round(rect.height * ratio);
    if (!nextWidth || !nextHeight) return;
    if (width === rect.width && height === rect.height
      && canvas.width === nextWidth && canvas.height === nextHeight) return;
    // Preserve partially scratched artwork when orientation or layout changes.
    let previous;
    if (width && height) {
      previous = document.createElement("canvas");
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext("2d").drawImage(canvas, 0, 0);
    }
    width = rect.width;
    height = rect.height;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(nextWidth / width, 0, 0, nextHeight / height, 0, 0);
    if (previous) {
      context.drawImage(previous, 0, 0, width, height);
    } else reset();
    last = null;
  }

  function erase(ctx, from, to) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = radius * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (from) {
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      ctx.arc(to.x, to.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function flush(now) {
    frame = 0;
    if (disposed || complete) return;
    coverage.setTransform(mask.width / width, 0, 0, mask.height / height, 0, 0);
    for (const [from, to] of pending) {
      erase(context, from, to);
      erase(coverage, from, to);
      dirty = true;
    }
    pending = [];
    // At most ten small readbacks per second, with a final check after lifting.
    if (dirty && (now - lastCheck >= 100 || pointer === null)) {
      dirty = false;
      lastCheck = now;
      const pixels = coverage.getImageData(0, 0, mask.width, mask.height).data;
      let cleared = 0;
      for (let i = 3; i < pixels.length; i += 4) cleared += 1 - pixels[i] / 255;
      const percent = Math.min(100, Math.round(cleared / (mask.width * mask.height) * 100));
      if (percent !== progress) { progress = percent; onProgress(percent); }
      if (percent >= 42) {
        complete = true;
        pointer = null;
        last = null;
        onProgress(100);
        // Keep the code hidden until the server confirms this coupon's state.
        Promise.resolve().then(onComplete).then((allowed) => {
          if (disposed) return;
          if (allowed === false) reset();
          else canvas.classList.add("canvas-revealed");
        }).catch(() => reset());
      }
    }
    // Ensure the last batch gets measured even when movement stops mid-stroke.
    if (dirty && !complete) {
      schedule();
    }
  }

  function schedule() {
    if (!frame && !disposed && !complete) frame = requestAnimationFrame(flush);
  }

  function collect(event) {
    if (disposed || complete || event.pointerId !== pointer) return;
    if (event.cancelable) event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const native = event.nativeEvent || event;
    const coalesced = native.getCoalescedEvents?.() || [];
    for (const sample of coalesced.length ? coalesced : [event]) {
      const point = { x: (sample.clientX - rect.left) * width / rect.width,
        y: (sample.clientY - rect.top) * height / rect.height };
      pending.push([last, point]);
      last = point;
    }
    schedule();
  }

  resize();
  return {
    resize,
    start(event) {
      if (disposed || complete || pointer !== null || event.isPrimary === false
        || (event.pointerType === "mouse" && event.button !== 0)) return;
      pointer = event.pointerId;
      last = null;
      try { canvas.setPointerCapture(pointer); } catch { /* A cancelled touch may already be gone. */ }
      collect(event);
    },
    move: collect,
    end(event) {
      if (event.pointerId !== pointer) return;
      if (event.type === "pointerup") collect(event);
      const id = pointer;
      pointer = null;
      last = null;
      try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch { /* Already released. */ }
      schedule();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      pending = [];
      pointer = null;
    },
  };
}
