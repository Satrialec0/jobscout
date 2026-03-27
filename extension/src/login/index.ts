const BACKEND_URL = process.env.BACKEND_URL;

function showSection(id: string) {
  ["login-section", "register-section", "api-key-section"].forEach((s) =>
    document.getElementById(s)!.classList.toggle("hidden", s !== id),
  );
}

// Toggle forms
document.getElementById("show-register")!.addEventListener("click", () => showSection("register-section"));
document.getElementById("show-login")!.addEventListener("click", () => showSection("login-section"));

async function afterLogin(token: string) {
  // Store JWT for the extension
  await chrome.storage.local.set({ auth_jwt: token });

  // Check if API key is already set
  try {
    const r = await fetch(`${BACKEND_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const user = await r.json();
      if (!user.has_api_key) {
        showSection("api-key-section");
        return;
      }
    }
  } catch {
    // Ignore — close anyway
  }
  window.close();
}

// Login form
document.getElementById("login-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-login") as HTMLButtonElement;
  const errEl = document.getElementById("login-error")!;
  errEl.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Signing in…";

  try {
    const r = await fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: (document.getElementById("login-email") as HTMLInputElement).value,
        password: (document.getElementById("login-password") as HTMLInputElement).value,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Login failed");
    await afterLogin(data.access_token);
  } catch (err: unknown) {
    errEl.textContent = (err as Error).message;
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});

// Register form
document.getElementById("register-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btn-register") as HTMLButtonElement;
  const errEl = document.getElementById("register-error")!;
  errEl.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Creating account…";

  try {
    const r = await fetch(`${BACKEND_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: (document.getElementById("reg-email") as HTMLInputElement).value,
        password: (document.getElementById("reg-password") as HTMLInputElement).value,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Registration failed");
    await afterLogin(data.access_token);
  } catch (err: unknown) {
    errEl.textContent = (err as Error).message;
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Create Account";
  }
});

// Save API key
document.getElementById("btn-save-key")!.addEventListener("click", async () => {
  const btn = document.getElementById("btn-save-key") as HTMLButtonElement;
  const errEl = document.getElementById("key-error")!;
  const okEl = document.getElementById("key-success")!;
  const key = (document.getElementById("key-input") as HTMLInputElement).value.trim();
  errEl.classList.add("hidden");

  if (!key) { errEl.textContent = "Please enter an API key."; errEl.classList.remove("hidden"); return; }

  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const data = await chrome.storage.local.get("auth_jwt");
    const token = data.auth_jwt as string;
    const r = await fetch(`${BACKEND_URL}/auth/api-key`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ api_key: key }),
    });
    const res = await r.json();
    if (!r.ok) throw new Error(res.detail || "Failed to save key");
    okEl.classList.remove("hidden");
    setTimeout(() => window.close(), 1500);
  } catch (err: unknown) {
    errEl.textContent = (err as Error).message;
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Save Key";
  }
});

// Skip
document.getElementById("skip-key")!.addEventListener("click", () => window.close());

export {};
