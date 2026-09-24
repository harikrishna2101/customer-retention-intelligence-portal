/**
 * nav.js — Universal Enterprise Suite nav dropdown injector
 * Add <script src="nav.js"></script> to any authenticated page nav.
 * Automatically adds the "Enterprise Suite" dropdown after any existing nav-link list.
 */
(function() {
    function markActiveNavLink() {
        const currentPage = window.location.pathname.split('/').pop() || 'home.html';
        document.querySelectorAll('.nav-link[href]').forEach(link => {
            const hrefPage = link.getAttribute('href').split('?')[0].split('#')[0];
            link.classList.toggle('active', hrefPage === currentPage);
            if (hrefPage === currentPage) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }

    function injectEnterpriseDropdown() {
        const navCenter = document.querySelector('.nav-center');
        if (!navCenter) return;

        // Avoid double-injection — check for ANY existing Enterprise Suite element
        if (document.querySelector('.nav-enterprise-dropdown')) return;
        if (document.querySelector('.nav-dropdown')) return;
        const existing = Array.from(navCenter.querySelectorAll('button, div')).find(el => el.textContent.includes('Enterprise Suite'));
        if (existing) return;

        const currentPage = window.location.pathname.split('/').pop();

        const dropdown = document.createElement('div');
        dropdown.className = 'nav-enterprise-dropdown';
        dropdown.style.cssText = 'position:relative; display:inline-flex; align-items:center;';

        const modules = [
            { href: 'customer.html',   icon: 'bx-group',     color: 'var(--risk-green)',  label: 'Customers' },
            { href: 'helpdesk.html',   icon: 'bx-headphone', color: 'var(--risk-yellow)', label: 'Helpdesk' },
            { href: 'billing.html',    icon: 'bx-receipt',   color: 'var(--risk-red)',    label: 'Billing' },
            { href: 'campaigns.html',  icon: 'bx-broadcast', color: '#a78bfa',            label: 'Campaigns' },
        ];

        const isOnModule = modules.some(m => m.href === currentPage);

        dropdown.innerHTML = `
            <button id="ent-dd-btn" style="
                background: none; border: none; cursor: pointer;
                display: flex; align-items: center; gap: 0.3rem;
                font-size: 0.9rem; font-family: 'Poppins', sans-serif;
                color: var(--text-color); font-weight: ${isOnModule ? '600' : '400'};
                padding: 0; transition: opacity 0.2s;
            ">
                <i class="bx bx-grid-alt" style="font-size:1.05rem;"></i>
                Enterprise Suite
                <i class="bx bx-chevron-down" style="font-size:1rem; transition: transform 0.2s;" id="ent-chevron"></i>
            </button>
            <div id="ent-dd-menu" style="
                display: none; position: absolute;
                top: calc(100% + 12px); left: 50%; transform: translateX(-50%);
                background: var(--card-bg); border: 1px solid var(--border-color);
                border-radius: 14px; padding: 0.5rem; min-width: 210px;
                z-index: 9999; backdrop-filter: blur(20px);
                box-shadow: 0 20px 50px rgba(0,0,0,0.35);
            ">
                ${modules.map(m => `
                    <a href="${m.href}" style="
                        display: flex; align-items: center; gap: 0.75rem;
                        padding: 0.7rem 1rem; border-radius: 9px;
                        text-decoration: none; color: var(--text-color);
                        font-size: 0.88rem; font-weight: ${m.href === currentPage ? '700' : '500'};
                        background: ${m.href === currentPage ? 'var(--hover-bg)' : 'transparent'};
                        transition: background 0.15s;
                    "
                    onmouseenter="this.style.background='var(--hover-bg)'"
                    onmouseleave="this.style.background='${m.href === currentPage ? 'var(--hover-bg)' : 'transparent'}'">
                        <i class="bx ${m.icon}" style="font-size:1.1rem; color:${m.color}; flex-shrink:0;"></i>
                        ${m.label}
                        ${m.href === currentPage ? '<i class="bx bx-check" style="margin-left:auto; color:var(--risk-green);"></i>' : ''}
                    </a>
                `).join('')}
                <div style="margin: 0.4rem 0; border-top: 1px solid var(--border-color);"></div>
                <a href="dashboard.html" style="
                    display: flex; align-items: center; gap: 0.75rem;
                    padding: 0.6rem 1rem; border-radius: 9px;
                    text-decoration: none; color: var(--secondary-text);
                    font-size: 0.78rem; font-weight: 500; transition: background 0.15s;
                "
                onmouseenter="this.style.background='var(--hover-bg)'"
                onmouseleave="this.style.background='transparent'">
                    <i class="bx bx-arrow-back" style="font-size:1rem;"></i> Back to Dashboard
                </a>
            </div>
        `;

        // Insert dropdown before "Grow Corner" link, or append to navCenter
        const growLink = Array.from(navCenter.querySelectorAll('a')).find(a => a.textContent.trim() === 'Grow Corner');
        if (growLink) {
            navCenter.insertBefore(dropdown, growLink);
        } else {
            navCenter.appendChild(dropdown);
        }

        // Toggle logic
        const btn = document.getElementById('ent-dd-btn');
        const menu = document.getElementById('ent-dd-menu');
        const chevron = document.getElementById('ent-chevron');

        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            menu.style.display = isOpen ? 'none' : 'block';
            if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
        });

        document.addEventListener('click', function() {
            menu.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            markActiveNavLink();
            injectEnterpriseDropdown();
        });
    } else {
        markActiveNavLink();
        injectEnterpriseDropdown();
    }
})();
