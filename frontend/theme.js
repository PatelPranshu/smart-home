// theme.js

// 1. Check Local Storage on Load
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    const toggle = document.getElementById('theme-toggle');

    // Apply Saved Theme
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        if (toggle) toggle.checked = true;
    } else {
        document.body.classList.remove('dark-mode');
        if (toggle) toggle.checked = false;
    }
});

// 2. Toggle Function (Called by the switch)
function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    
    // Save preference
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}