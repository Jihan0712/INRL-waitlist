import { expect, test } from "@playwright/test";

// Every test mocks /api/join and blocks the real Turnstile script, so nothing leaves the machine.
async function mockJoin(page, handler) {
  const requests = [];
  await page.route("**/challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/api/join", async (route) => {
    requests.push(route.request().postDataJSON());
    await handler(route, requests.length);
  });
  return requests;
}

async function fillForm(page, { email = "ada@example.com" } = {}) {
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Lovelace");
  await page.getByLabel("Country").selectOption("DK");
  await page.getByLabel("Email address").fill(email);
}

test("a valid sign-up swaps to the confirmation state and focuses its heading", async ({ page }) => {
  const requests = await mockJoin(page, (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/?utm_source=instagram");
  await fillForm(page);
  await page.getByRole("button", { name: "Join the waitlist" }).click();

  const heading = page.getByRole("heading", { name: "You're on the list." });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.locator("#view-form")).toBeHidden();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ firstName: "Ada", lastName: "Lovelace", country: "DK", email: "ada@example.com", company: "", source: "instagram" });
});

test("an empty submit shows inline errors and sends nothing", async ({ page }) => {
  const requests = await mockJoin(page, (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Join the waitlist" }).click();

  await expect(page.getByText("Enter your first name.")).toBeVisible();
  await expect(page.getByText("Choose your country.")).toBeVisible();
  await expect(page.getByLabel("First name")).toBeFocused();
  await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  expect(requests).toHaveLength(0);

  await page.getByLabel("First name").fill("A");
  await expect(page.getByText("Enter your first name.")).toBeHidden();
});

test("a server failure keeps the values, re-enables the button, and a retry succeeds", async ({ page }) => {
  await mockJoin(page, (route, n) =>
    n === 1 ? route.fulfill({ status: 500, json: { ok: false, error: "unavailable", reason: "apps_script_forbidden" } }) : route.fulfill({ json: { ok: true } }),
  );
  await page.goto("/");
  await fillForm(page);
  const button = page.getByRole("button", { name: "Join the waitlist" });
  await button.click();

  await expect(page.getByRole("alert")).toContainText("Something went wrong on our side");
  await expect(page.getByLabel("Email address")).toHaveValue("ada@example.com");
  await expect(button).toBeEnabled();

  await button.click();
  await expect(page.getByRole("heading", { name: "You're on the list." })).toBeVisible();
});

test("field errors from the server are shown on the right field", async ({ page }) => {
  await mockJoin(page, (route) => route.fulfill({ status: 400, json: { ok: false, error: "invalid", fields: ["email"] } }));
  await page.goto("/");
  await fillForm(page, { email: "ada@example.c0m" });
  await page.getByRole("button", { name: "Join the waitlist" }).click();

  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeFocused();
});

test("a failed bot check explains what to do", async ({ page }) => {
  await mockJoin(page, (route) => route.fulfill({ status: 400, json: { ok: false, error: "verification" } }));
  await page.goto("/");
  await fillForm(page);
  await page.getByRole("button", { name: "Join the waitlist" }).click();

  await expect(page.getByRole("alert")).toContainText("couldn't check that you're human");
});

test("a dropped connection shows a network message", async ({ page }) => {
  await mockJoin(page, (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await fillForm(page);
  await page.getByRole("button", { name: "Join the waitlist" }).click();

  await expect(page.getByRole("alert")).toContainText("couldn't reach the server");
});

test("double-clicking submit sends only one request", async ({ page }) => {
  const requests = await mockJoin(page, async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await fillForm(page);
  await page.getByRole("button", { name: "Join the waitlist" }).dblclick();

  await expect(page.getByRole("heading", { name: "You're on the list." })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("the hero button moves focus to the form", async ({ page }) => {
  await mockJoin(page, (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  await page.locator(".hero__cta").click();
  await expect(page.getByLabel("First name")).toBeFocused();
});

test("the announcement stays dismissed after a reload", async ({ page }) => {
  await mockJoin(page, (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss announcement" }).click();
  await expect(page.getByText("A T-shirt. A video you choose.").first()).toBeHidden();
  await page.reload();
  await expect(page.locator("#announcement")).toBeHidden();
});

test("the page never scrolls sideways", async ({ page }) => {
  await mockJoin(page, (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
