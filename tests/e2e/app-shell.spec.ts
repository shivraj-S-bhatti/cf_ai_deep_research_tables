import { expect, test } from "../../playwright-fixture";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shotDir = join(__dirname, "../../test-results/e2e-screenshots");

test("loads the initial research shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Research, structured." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Research" }),
  ).toBeDisabled();

  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: join(shotDir, "01-home.png"), fullPage: true });
});

test("walks from preview into progressive results", async ({ page }) => {
  mkdirSync(shotDir, { recursive: true });
  await page.goto("/");

  await page.getByPlaceholder("e.g. YC W24 healthcare startups").fill("YC W24 healthcare startups");
  await page.getByRole("button", { name: "Start Research" }).click();

  await expect(page.getByText("Criteria (3)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Search" })).toBeVisible();

  await page.getByRole("button", { name: "Run Search" }).click();

  // Without onToggleDebug, ActionToolbar renders Debug as a link that opens /threads/:id/debug in a new tab.
  const debugLink = page.getByRole("link", { name: "Debug", exact: true }).first();
  await expect(debugLink).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Sprout Labs")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("table").getByText("Accepted").first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("Unmatched candidates")).toBeVisible({ timeout: 10000 });

  const threadsToggle = page.getByRole("button", { name: "Show research threads" });
  await expect(threadsToggle).toBeVisible();
  await threadsToggle.click();
  await expect(page.getByText("New Research")).toBeVisible();
  await expect(page.getByText("YC W24 healthcare startups")).toBeVisible();
  await expect(page.getByText("Sprout Labs")).toBeVisible();
  await page.getByRole("button", { name: "Close threads panel" }).click();

  await expect(page.getByText("Sprout Labs")).toBeVisible();
  await page.getByRole("button", { name: "Show research threads" }).click();
  await expect(page.getByText("New Research")).toBeVisible();
  await page.getByRole("button", { name: "Close threads panel" }).click();

  await page.screenshot({ path: join(shotDir, "02-results-table.png"), fullPage: true });

  await page.getByRole("tab", { name: "Run" }).click();
  await expect(page.getByTestId("run-execution-summary")).toBeVisible();
  await expect(page.getByTestId("run-execution-summary").getByText("Cost")).toBeVisible();

  const debugPagePromise = page.context().waitForEvent("page");
  await debugLink.click();
  const debugPage = await debugPagePromise;
  await debugPage.waitForLoadState("domcontentloaded");
  await expect(debugPage.getByRole("heading", { name: "Debug workspace" })).toBeVisible();
  await debugPage.screenshot({ path: join(shotDir, "03-debug-full-page.png"), fullPage: true });

  await debugPage.getByRole("tab", { name: /Ledger/i }).click();
  await expect(debugPage.getByRole("heading", { name: "Provider ledger" })).toBeVisible();

  await debugPage.getByRole("tab", { name: /^Trace/i }).click();
  await expect(debugPage.getByRole("heading", { name: "Trace", exact: true })).toBeVisible();

  await debugPage.screenshot({ path: join(shotDir, "04-debug-trace-tab.png"), fullPage: true });
  await debugPage.close();
});
