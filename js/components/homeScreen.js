export function dismissSplashScreen() {
    const splash = document.getElementById('splash-screen');
    
    if (splash) {
        // Trigger the CSS fade animation
        splash.classList.add('fade-out');

        // Wait 600ms for the CSS transition to finish, then delete it from memory
        setTimeout(() => {
            splash.remove();
            console.log("Splash screen unmounted. Ready for interaction.");
        }, 600); 
    }
}
