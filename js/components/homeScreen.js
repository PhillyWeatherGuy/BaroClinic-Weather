// Record the exact time this file loads in the browser
const startTime = performance.now();

export function dismissSplashScreen() {
    const splash = document.getElementById('splash-screen');
    
    if (splash) {
        // Calculate how much time has passed since the app started loading
        const elapsed = performance.now() - startTime;
        const minDisplayTime = 3000; // 3 seconds (3000 milliseconds)
        
        // If elapsed is less than 3000, wait the remaining time. If more, wait 0.
        const remainingTime = Math.max(0, minDisplayTime - elapsed);

        setTimeout(() => {
            // Trigger the CSS fade animation
            splash.classList.add('fade-out');

            // Wait 600ms for the CSS transition to finish, then delete it
            setTimeout(() => {
                splash.remove();
                console.log("Splash screen unmounted. Ready for interaction.");
            }, 600); 

        }, remainingTime); 
    }
}