var BASE_URL = "";

// Fetch CSRF token from backend before any mutating request
async function getCsrfToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/csrf-token`, { credentials: 'include' });
        const data = await res.json();
        return data.csrfToken || '';
    } catch (e) {
        console.warn('Could not fetch CSRF token:', e);
        return '';
    }
}

document.addEventListener('DOMContentLoaded', () => {

    // ─────────────────────────────────────────────
    // THEME TOGGLE
    // ─────────────────────────────────────────────
    const themeToggleBtn = document.getElementById('theme-toggle');
    const htmlElement = document.documentElement;

    let vantaEffect = null;

    const initVantaBg = (theme) => {
        try {
            if (typeof VANTA === 'undefined' || typeof VANTA.RINGS !== 'function') return;
            if (vantaEffect) vantaEffect.destroy();
            vantaEffect = VANTA.RINGS({
                el: "#vanta-bg",
                mouseControls: true,
                touchControls: true,
                gyroControls: false,
                minHeight: 200.00,
                minWidth: 200.00,
                scale: 1.00,
                scaleMobile: 1.00,
                color: theme === 'dark' ? 0xdddddd : 0x222222,
                backgroundAlpha: 0.00,
                backgroundColor: 0x000000
            });
        } catch(e) { /* Vanta not available on this page — safe to ignore */ }
    };

    const savedTheme = localStorage.getItem('crip-theme');
    const initialTheme = savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';

    htmlElement.setAttribute('data-theme', initialTheme);

    if (themeToggleBtn) {
        const themeIcon = themeToggleBtn.querySelector('i');
        if (themeIcon) themeIcon.className = initialTheme === 'dark' ? 'bx bx-sun' : 'bx bx-moon';

        initVantaBg(initialTheme);

        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = htmlElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

            if (themeIcon) themeIcon.className = newTheme === 'dark' ? 'bx bx-sun' : 'bx bx-moon';
            htmlElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('crip-theme', newTheme);

            initVantaBg(newTheme);
        });
    } else {
        initVantaBg(initialTheme);
    }

    // ─────────────────────────────────────────────
    // DYNAMIC PUBLIC NAVIGATION STATE
    // ─────────────────────────────────────────────
    const loginLink = document.querySelector('a[href="login.html"]');
    if (loginLink && loginLink.textContent.includes('Log In')) {
        fetch(`${BASE_URL}/api/auth/verify-session`, { credentials: "include" })
        .then(res => {
            if (res.ok) {
                // User is fully authenticated, modify public interface to private router
                loginLink.textContent = "Dashboard";
                loginLink.href = "dashboard.html";
                loginLink.style.background = "var(--risk-green)";
                
                const contactLink = document.querySelector('a[href="contact.html"]');
                if (contactLink) contactLink.style.display = 'none';

                document.querySelectorAll('a[href="getstarted.html"]').forEach(homeLink => {
                    homeLink.href = "home.html";
                });
            }
        })
        .catch(err => { /* Soft fail, keep public display */ });
    }

    // ─────────────────────────────────────────────
    // LOGIN FORM
    // ─────────────────────────────────────────────
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = document.getElementById("email").value;
            const password = document.getElementById("password").value;
            const submitBtn = loginForm.querySelector("button[type='submit']");

            if (!email || !password) {
                alert("Please enter both email and password.");
                return;
            }

            // Prevent double-click / double-submit
            submitBtn.disabled = true;
            submitBtn.textContent = "Verifying...";

            try {
                const csrfToken = await getCsrfToken();
                const res = await fetch(`${BASE_URL}/api/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
                    credentials: "include",
                    body: JSON.stringify({ email, password })
                });

                const data = await res.json();
                if (!res.ok) {
                    alert(data.message || "Login failed.");
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = "Verify Credentials & Request OTP <i class='bx bx-lock-open-alt'></i>";
                    return;
                }

                if (data.success) {
                    localStorage.setItem("email", email.toLowerCase().trim());
                    window.location.href = "otp.html";
                }
            } catch (err) {
                alert("Cannot reach server. Please try again later.");
                console.error(err);
                submitBtn.disabled = false;
                submitBtn.innerHTML = "Verify Credentials & Request OTP <i class='bx bx-lock-open-alt'></i>";
            }
        });
    }

    // ─────────────────────────────────────────────
    // OTP VERIFY FORM
    // ─────────────────────────────────────────────
    const otpForm = document.getElementById("otpForm");
    if (otpForm) {
        otpForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const otp = document.getElementById("otp").value.trim();
            const email = localStorage.getItem("email");

            if (!email) {
                alert("Session lost. Please log in again.");
                window.location.href = "login.html";
                return;
            }

            try {
                const csrfToken = await getCsrfToken();
                const res = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
                    credentials: "include",
                    body: JSON.stringify({ email, otp })
                });

                const data = await res.json();
                if (!res.ok) {
                    alert(data.message || "Invalid OTP.");
                    return;
                }

                if (data.success) {
                    localStorage.removeItem("email");
                    window.location.href = "home.html";
                }
            } catch (err) {
                alert("Cannot reach server. Please try again later.");
                console.error(err);
            }
        });
    }

    // ─────────────────────────────────────────────
    // SIGNUP FORM
    // ─────────────────────────────────────────────
    const signupForm = document.getElementById("signupForm");
    if (signupForm) {
        signupForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = document.getElementById("name").value;
            const email = document.getElementById("email").value;
            const password = document.getElementById("password").value;
            const organization = document.getElementById("organization").value;
            const industry = document.getElementById("industry").value;

            try {
                const csrfToken = await getCsrfToken();
                const res = await fetch(`${BASE_URL}/api/auth/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
                    credentials: "include",
                    body: JSON.stringify({ name, email, password, organization, industry })
                });

                const data = await res.json();
                if (!res.ok) {
                    alert(data.message || "Registration failed.");
                    return;
                }

                if (data.success) {
                    alert("Account created successfully! Please log in.");
                    window.location.href = "login.html";
                }
            } catch (err) {
                alert("Cannot reach server. Please try again later.");
                console.error(err);
            }
        });
    }

    // ─────────────────────────────────────────────
    // CONTACT FORM
    // ─────────────────────────────────────────────
    const contactForm = document.getElementById("contactForm");
    if (contactForm) {
        contactForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = document.getElementById("name").value;
            const email = document.getElementById("email").value;
            const message = document.getElementById("message").value;

            try {
                const csrfToken = await getCsrfToken();
                const res = await fetch(`${BASE_URL}/api/contact`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
                    credentials: "include",
                    body: JSON.stringify({ name, email, message })
                });

                const data = await res.json();
                if (!res.ok) {
                    alert(data.message || "Failed to send message.");
                    return;
                }

                alert("Message sent successfully!");
                contactForm.reset();
            } catch (err) {
                alert("Cannot reach server. Please try again later.");
                console.error(err);
            }
        });
    }

    // ─────────────────────────────────────────────
    // FORGOT PASSWORD FORM
    // ─────────────────────────────────────────────
    const forgotPasswordForm = document.getElementById("forgotPasswordForm");
    if (forgotPasswordForm) {
        forgotPasswordForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = document.getElementById("recoveryEmail").value;

            try {
                const csrfToken = await getCsrfToken();
                const res = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
                    credentials: "include",
                    body: JSON.stringify({ email })
                });

                const data = await res.json();
                if (data.success) {
                    localStorage.setItem("reset-email", email.toLowerCase().trim());
                    // Show resend button and update send button label on SUCCESS only
                    const resendBtn = document.getElementById('resendOtpBtn');
                    const sendBtn = document.getElementById('sendOtpBtn');
                    if (resendBtn) resendBtn.style.display = 'flex';
                    if (sendBtn) sendBtn.innerHTML = "OTP Sent! Check Email <i class='bx bx-check'></i>";
                    alert("If that email is registered, an OTP has been sent. Check your inbox.");
                    window.location.href = "reset-password.html";
                } else {
                    // Reset button on failure
                    const sendBtn = document.getElementById('sendOtpBtn');
                    if (sendBtn) sendBtn.innerHTML = "Send Recovery Code <i class='bx bx-envelope'></i>";
                    alert(data.message || "Something went wrong.");
                }
            } catch (err) {
                alert("Cannot reach server. Please try again later.");
                console.error(err);
            }
        });

        // RESEND OTP BUTTON
        const resendOtpBtn = document.getElementById("resendOtpBtn");
        if (resendOtpBtn) {
            resendOtpBtn.addEventListener("click", async () => {
                const email = document.getElementById("recoveryEmail").value;
                if (!email) {
                    alert("Please enter your email address first.");
                    return;
                }

                resendOtpBtn.disabled = true;
                resendOtpBtn.textContent = "Sending...";

                try {
                    await fetch(`${BASE_URL}/api/auth/forgot-password`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ email })
                    });
                    alert("OTP re-sent! Check your inbox and Spam folder.");
                } catch (err) {
                    alert("Cannot reach server. Please try again later.");
                    console.error(err);
                } finally {
                    resendOtpBtn.disabled = false;
                    resendOtpBtn.innerHTML = "Resend OTP <i class='bx bx-refresh'></i>";
                }
            });
        }
    }

    // ─────────────────────────────────────────────
    // RESET PASSWORD FORM
    // ─────────────────────────────────────────────
    const resetPasswordForm = document.getElementById("resetPasswordForm");
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const otp = document.getElementById("resetOtp").value.trim();
            const newPassword = document.getElementById("newPassword").value;
            const confirmPassword = document.getElementById("confirmPassword").value;
            const email = localStorage.getItem("reset-email");

            if (!email) {
                alert("Session lost. Please go back and enter your email again.");
                window.location.href = "forgot-password.html";
                return;
            }

            if (newPassword !== confirmPassword) {
                alert("Passwords do not match. Please try again.");
                return;
            }

            if (newPassword.length < 6) {
                alert("Password must be at least 6 characters long.");
                return;
            }

            try {
                const csrfToken = await getCsrfToken();
                const res = await fetch(`${BASE_URL}/api/auth/reset-password`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
                    credentials: "include",
                    body: JSON.stringify({ email, otp, newPassword })
                });

                const data = await res.json();
                if (!res.ok) {
                    alert(data.message || "Reset failed. Invalid or expired OTP.");
                    return;
                }

                if (data.success) {
                    localStorage.removeItem("reset-email");
                    alert("Password reset successfully! Please log in with your new password.");
                    window.location.href = "login.html";
                }
            } catch (err) {
                alert("Cannot reach server. Please try again later.");
                console.error(err);
            }
        });
    }

});