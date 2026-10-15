import { COUNTRIES } from "./countries.js";

// Longer than the server's 25 s wait for Apps Script, so the server's own error message wins.
const REQUEST_TIMEOUT_MS = 35000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Preselected in the Country dropdown. Set to "" to make people choose.
const DEFAULT_COUNTRY = "PH";

const MESSAGES = {
  firstName: "Enter your first name.",
  lastName: "Enter your last name.",
  country: "Choose your country.",
  email: "Enter a valid email address, like you@email.com.",
  verification: "We couldn't check that you're human. Turn off ad blockers for this page, or wait a moment, then try again.",
  unavailable: "Something went wrong on our side. Your details are still here, so please try again.",
  network: "We couldn't reach the server. Check your connection and try again.",
};

const form = document.getElementById("waitlist-form");
const statusEl = document.getElementById("form-status");
const submitBtn = form.querySelector(".form__submit");
const submitLabel = submitBtn.textContent;
let inFlight = false;

fillCountries();
setUpAnnouncement();
setUpScrollToForm();
setUpMedia();
form.addEventListener("submit", onSubmit);
for (const el of form.querySelectorAll("input, select")) {
  el.addEventListener("input", () => clearFieldError(el.name));
}

function fillCountries() {
  const select = document.getElementById("country");
  const frag = document.createDocumentFragment();
  for (const [code, name] of COUNTRIES) {
    frag.append(new Option(name, code));
  }
  select.append(frag);
  select.value = DEFAULT_COUNTRY;
}

function setUpAnnouncement() {
  const bar = document.getElementById("announcement");
  try {
    if (localStorage.getItem("inrl:announcement-dismissed") === "1") bar.hidden = true;
  } catch {}
  bar.querySelector("button").addEventListener("click", () => {
    bar.hidden = true;
    try { localStorage.setItem("inrl:announcement-dismissed", "1"); } catch {}
  });
}

function setUpScrollToForm() {
  for (const link of document.querySelectorAll("[data-scroll-to-form]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("join").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
      document.getElementById("firstName").focus({ preventScroll: true });
    });
  }
}

function setUpMedia() {
  const video = document.querySelector(".hero__video");
  if (video) {
    const source = video.querySelector("source");
    const hide = () => video.classList.add("is-missing");
    source?.addEventListener("error", hide);
    video.addEventListener("error", hide);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.removeAttribute("autoplay");
      video.pause();
    }
  }
  for (const img of document.querySelectorAll(".media img")) {
    const mark = () => img.classList.add("is-missing");
    if (img.complete && img.naturalWidth === 0) mark();
    img.addEventListener("error", mark);
  }
}

// Mirrors the server rules in functions/api/join.js so people see errors before a round trip.
function validateFields(values) {
  const errors = {};
  if (!values.firstName.trim()) errors.firstName = MESSAGES.firstName;
  if (!values.lastName.trim()) errors.lastName = MESSAGES.lastName;
  if (!values.country) errors.country = MESSAGES.country;
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = MESSAGES.email;
  return errors;
}

function readValues() {
  const data = new FormData(form);
  return {
    firstName: String(data.get("firstName") ?? ""),
    lastName: String(data.get("lastName") ?? ""),
    country: String(data.get("country") ?? ""),
    email: String(data.get("email") ?? ""),
    company: String(data.get("company") ?? ""),
    turnstileToken: String(data.get("cf-turnstile-response") ?? ""),
    source: new URLSearchParams(location.search).get("utm_source") ?? "",
  };
}

async function onSubmit(event) {
  event.preventDefault();
  if (inFlight) return;

  hideStatus();
  const values = readValues();
  const errors = validateFields(values);
  showFieldErrors(errors);
  const firstInvalid = Object.keys(errors)[0];
  if (firstInvalid) {
    form.elements[firstInvalid].focus();
    return;
  }

  setBusy(true);
  try {
    const result = await postJoin(values);
    if (result.ok) {
      showConfirmation();
      return;
    }
    if (result.fields) {
      const fieldErrors = Object.fromEntries(result.fields.map((name) => [name, MESSAGES[name] ?? MESSAGES.unavailable]));
      showFieldErrors(fieldErrors);
      form.elements[result.fields[0]]?.focus();
    } else {
      showStatus(MESSAGES[result.error] ?? MESSAGES.unavailable);
    }
  } finally {
    setBusy(false);
    // Turnstile tokens are single use; get a fresh one for the next attempt.
    window.turnstile?.reset?.();
  }
}

async function postJoin(values) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.ok) return { ok: true };
    return { ok: false, error: body.error ?? "unavailable", fields: body.fields };
  } catch {
    return { ok: false, error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function showFieldErrors(errors) {
  for (const name of ["firstName", "lastName", "country", "email"]) {
    const message = errors[name];
    const input = form.elements[name];
    const errorEl = document.getElementById(`${name}-error`);
    input.setAttribute("aria-invalid", message ? "true" : "false");
    errorEl.textContent = message ?? "";
    errorEl.hidden = !message;
  }
}

function clearFieldError(name) {
  const errorEl = document.getElementById(`${name}-error`);
  if (!errorEl || errorEl.hidden) return;
  errorEl.hidden = true;
  form.elements[name].setAttribute("aria-invalid", "false");
}

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = false;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
}

function setBusy(busy) {
  inFlight = busy;
  submitBtn.disabled = busy;
  submitBtn.textContent = busy ? "Joining…" : submitLabel;
  form.setAttribute("aria-busy", String(busy));
}

function showConfirmation() {
  document.getElementById("view-form").hidden = true;
  document.getElementById("view-confirm").hidden = false;
  document.body.dataset.state = "joined";
  window.scrollTo({ top: 0 });
  document.getElementById("confirm-title").focus();
}
