(function () {
  const cards = Array.from(document.querySelectorAll('.people-parallax .person-card'));
  if (!cards.length) return;

  function onScroll() {
    const viewportH = window.innerHeight || 1;
    cards.forEach((card, idx) => {
      const rect = card.getBoundingClientRect();
      const centerOffset = rect.top + rect.height / 2 - viewportH / 2;
      const depth = (idx % 3) + 1;
      const translateY = Math.max(-8, Math.min(8, -centerOffset * 0.012 * depth));
      card.style.transform = `translateY(${translateY}px)`;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
