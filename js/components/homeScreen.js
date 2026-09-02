// js/components/homeScreen.js
const startTime = performance.now();

// Renamed this to reflect its new job
export function initHubTransition(onSelectMode = null) {
    const splash = document.getElementById('splash-screen');
    const grid = document.getElementById('home-menu-grid');
    const splashText = document.getElementById('splash-text');
    
    if (!splash || !grid) return;

    const elapsed = performance.now() - startTime;
    const minDisplayTime = 3000; 
    const remainingTime = Math.max(0, minDisplayTime - elapsed);

    // 1. REVEAL THE HUB GRID
    setTimeout(() => {
        if (splashText) splashText.textContent = "READY";
        
        setTimeout(() => {
            splash.classList.add('hub-active');
        }, 500);

    }, remainingTime); 

    // 2. LISTEN FOR CLICKS ON THE CARDS
    const cards = document.querySelectorAll('.menu-card');
    cards.forEach(card => {
        card.addEventListener('click', (e) => {
            const targetView = e.currentTarget.dataset.target;
            
            // Trigger the staggered fade-out in CSS
            grid.classList.add('exiting');
            
            // Wait 700ms (longest card fade is 0.3s delay + 0.4s fade = 0.7s)
            setTimeout(() => {
                splash.classList.add('fade-out');
                
                // Wait 600ms for background to fade, then destroy the container
                setTimeout(() => {
                    splash.remove();
                    console.log(`Entering view: ${targetView}. Map is interactive.`);
                    
                    // 🌟 Notify app to switch modes and unload previous weather data
                    if (typeof onSelectMode === 'function') {
                        onSelectMode(targetView);
                    }
                }, 600);
            }, 700); 
        });
    });
}
