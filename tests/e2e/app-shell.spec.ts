import { expect, test } from "../../playwright-fixture";

test("loads the initial research shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "What are you researching?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Research" }),
  ).toBeDisabled();
});

test("walks from preview into progressive results", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("e.g. YC W24 healthcare startups").fill("YC W24 healthcare startups");
  await page.getByRole("button", { name: "Start Research" }).click();

  await expect(page.getByText("Criteria (3)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Search" })).toBeVisible();

  await page.getByRole("button", { name: "Run Search" }).click();

  await expect(page.getByRole("button", { name: "Execution" })).toBeVisible();
  await expect(page.getByText("Sprout Labs")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("table").getByText("Accepted").first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("Unmatched candidates")).toBeVisible({ timeout: 10000 });

  await page.getByRole("tab", { name: "Internals" }).click();
  await expect(page.getByText("Reward proxies")).toBeVisible();
  await expect(page.getByText("Tool surface")).toBeVisible();
  await expect(page.getByText("plan_query", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Execution" }).click();
  await expect(page.getByText("Execution Trace")).toBeVisible();
  await page.getByRole("button", { name: /Planning query/ }).nth(1).click();
  await expect(page.getByText("Reasoning Summary")).toBeVisible();
  await expect(page.getByText("Tool Calls", { exact: true })).toBeVisible();
});
