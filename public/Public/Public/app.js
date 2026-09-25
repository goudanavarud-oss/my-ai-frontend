import { SUPABASE_ANON_KEY, SUPABASE_URL } from "/frontend-config.js";

const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.querySelector("#auth-form");
const tabs = document.querySelectorAll(".auth-tab");
const title = document.querySelector("#auth-title");
const subtitle = document.querySelector("#auth-subtitle");
const confirmWrap = document.querySelector("#confirm-wrap");
const confirmPassword = document.querySelector("#confirm-password");
const submitButton = document.querySelector("#auth-submit");
const submitLabel = document.querySelector("#auth-submit-label");
const message = document.querySelector("#auth-message");

let mode = "login";

function showMessage(text, type = "error") {
  message.textContent = text;
  message.className = `mb-5 rounded-xl border px-4 py-3 text-sm leading-5 ${
    type === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : "border-rose-400/20 bg-rose-400/10 text-rose-200"
  }`;
}

function clearMessage() {
  message.textContent = "";
  message.className = "mb-5 hidden rounded-xl border px-4 py-3 text-sm leading-5";
}

function setMode(nextMode) {
  mode = nextMode;
  const isSignup = mode === "signup";

  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  title.textContent = isSignup ? "Create your workspace" : "Sign in to Flowstate";
  subtitle.textContent = isSignup
    ? "Start turning your best work into a repeatable system."
    : "Pick up exactly where you left off.";
  confirmWrap.classList.toggle("hidden", !isSignup);
  confirmPassword.required = isSignup;
  submitLabel.textContent = isSignup ? "Create my workspace" : "Continue to workspace";
  clearMessage();
}

tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const email = new FormData(form).get("email").trim();
  const password = new FormData(form).get("password");

  if (mode === "signup" && password !== confirmPassword.value) {
    showMessage("Those passwords do not match.");
    return;
  }

  submitButton.disabled = true;
  submitLabel.textContent = mode === "signup" ? "Creating workspace…" : "Signing you in…";

  const result =
    mode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

  submitButton.disabled = false;
  submitLabel.textContent = mode === "signup" ? "Create my workspace" : "Continue to workspace";

  if (result.error) {
    showMessage(result.error.message);
    return;
  }

  if (mode === "signup" && !result.data.session) {
    showMessage("Account created. Check your email to confirm your account, then sign in.", "success");
    return;
  }

  window.location.assign("/dashboard.html");
});

const { data } = await supabase.auth.getSession();
if (data.session) {
  window.location.replace("/dashboard.html");
                      }
