(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const data = id ? (await chrome.storage.local.get(id))[id] : null;

  if (!data) {
    document.body.textContent = 'This clone is no longer available. Run the extension again to create a new one.';
    return;
  }

  // Replace this page with the snapshot of the original site
  document.open();
  document.write(data.html);
  document.close();

  // Apply the AI-generated styles on top
  const style = document.createElement('style');
  style.id = 'ai-custom-style';
  style.textContent = data.css;
  (document.head || document.documentElement).appendChild(style);

  // The <base> tag would make "#section" links jump to the original site, so handle them here
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const hash = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!hash) { window.scrollTo(0, 0); return; }
    const target = document.getElementById(hash) || document.getElementsByName(hash)[0];
    if (target) target.scrollIntoView();
  }, true);
})();
