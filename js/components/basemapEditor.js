export function initBasemapEditor() {
    const toggleBtn = document.getElementById('btn-basemap-editor');
    const closeBtn = document.getElementById('btn-close-basemap-editor');
    const panel = document.getElementById('basemap-editor-panel');

    if (!toggleBtn || !panel) return;

    const setOpen = (isOpen) => {
        panel.classList.toggle('open', isOpen);
        panel.setAttribute('aria-hidden', String(!isOpen));
        toggleBtn.classList.toggle('active', isOpen);
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
    };

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!panel.classList.contains('open'));
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(false);
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('open')) {
            setOpen(false);
        }
    });
}
