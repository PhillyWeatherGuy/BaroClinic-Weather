const STORAGE_KEY = 'baroclinic-viewer-preferences';

export function getViewerPreferences() {
    try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        return {};
    }
}

export function saveViewerPreferences(updates) {
    try {
        const preferences = { ...getViewerPreferences(), ...updates };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {}
}