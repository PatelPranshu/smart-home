// theme.js
document.addEventListener('DOMContentLoaded', () => {
    // 1. Check Local Storage or System Preference on Load
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
        updateToggleState(true);
    }

    // 2. Expose Toggle Function globally
    window.toggleTheme = () => {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        
        // Update checkbox if triggered manually or via code
        updateToggleState(newTheme === 'dark');
    };
});

function updateToggleState(isDark) {
    const toggle = document.getElementById('theme-toggle');
    if(toggle) toggle.checked = isDark;
}