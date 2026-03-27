const API = "";  // same origin

function getToken() { return localStorage.getItem("jobscout_jwt"); }
function setToken(t) { localStorage.setItem("jobscout_jwt", t); }

// Redirect if already logged in
(async () => {
  const token = getToken();
  if (token) {
    const r = await fetch(`${API}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { window.location.href = "dashboard.html"; return; }
    localStorage.removeItem("jobscout_jwt");
  }
})();

// Toggle forms
document.getElementById("show-register").addEventListener("click", () => {
  document.getElementById("login-section").classList.add("hidden");
  document.getElementById("register-section").classList.remove("hidden");
});
document.getElementById("show-login").addEventListener("click", () => {
  document.getElementById("register-section").classList.add("hidden");
  document.getElementById("login-section").classList.remove("hidden");
});

// Login
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-login");
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  btn.disabled = true; btn.textContent = "Signing in…";

  try {
    const r = await fetch(`${API}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Login failed");
    setToken(data.access_token);
    window.location.href = "dashboard.html";
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
    btn.disabled = false; btn.textContent = "Sign In";
  }
});

// Register
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-register");
  const errEl = document.getElementById("register-error");
  errEl.classList.add("hidden");
  btn.disabled = true; btn.textContent = "Creating account…";

  try {
    const r = await fetch(`${API}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("reg-email").value,
        password: document.getElementById("reg-password").value,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Registration failed");
    setToken(data.access_token);
    // New users go to settings to add their API key
    window.location.href = "settings.html?new=1";
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
    btn.disabled = false; btn.textContent = "Create Account";
  }
});
