import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const fixture = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "populated-state.json"), "utf8"));

async function openWithFixture(page) {
  await page.goto("/?goldenTest=1");
  await page.waitForFunction(() => Boolean(window.__pechakTestApi));
  const synthetic = structuredClone(fixture);
  synthetic.state.accounts.push({ name: "External / World", cls: "External", liq: "-", kind: "External", open: 0 });
  synthetic.state.txns = synthetic.state.txns.map(transaction => ({
    ...transaction,
    from: transaction.from === "External" ? "External / World" : transaction.from,
    to: transaction.to === "External" ? "External / World" : transaction.to
  }));
  await page.evaluate(data => window.__pechakTestApi.loadFixture(data), synthetic);
}

test("fresh onboarding completes through the visible wizard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Let's set up your ledger" })).toBeVisible();
  await page.getByRole("button", { name: /Review starter setup/ }).click();
  await expect(page.getByRole("heading", { name: "Review your accounts" })).toBeVisible();
  await page.getByLabel("Add another (optional)").fill("Synthetic Bank");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review your categories" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Log your first transaction" })).toBeVisible();
  await page.locator("#syncRemindClose").click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.getByText("No transactions yet")).toBeVisible();
});

test("add and edit transaction persists across reload", async ({ page }) => {
  await openWithFixture(page);
  await page.locator("#nav").getByRole("button", { name: /Transactions/ }).click();
  const form = page.locator("#v-txns");
  await form.getByLabel("Amount ₹").fill("4321");
  await form.getByLabel("Category").selectOption("Food");
  await form.getByLabel("Comment").fill("Synthetic journey");
  await form.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(page.getByText("Synthetic journey")).toBeVisible();
  await page.getByRole("row", { name: /Synthetic journey/ }).getByTitle("Edit", { exact: true }).click();
  await form.getByLabel("Comment").fill("Synthetic journey edited");
  await form.getByRole("button", { name: "Update transaction" }).click();
  await page.reload();
  await page.locator("#nav").getByRole("button", { name: /Transactions/ }).click();
  await expect(page.getByText("Synthetic journey edited")).toBeVisible();
});

test("primary navigation exposes report, tax and data destinations", async ({ page }) => {
  await openWithFixture(page);
  for (const [button, heading] of [["Transactions", "Transactions"], ["Needs Attention", "Needs Attention"], ["Data", "Data"]]) {
    await page.locator("#nav").getByRole("button", { name: new RegExp(button) }).click();
    await expect(page.locator("#viewTitle")).toHaveText(heading);
  }
  await page.locator("#nav").getByRole("button", { name: /Reports/ }).click();
  await page.locator("#nav").getByRole("button", { name: "Statements" }).click();
  await expect(page.locator("#viewTitle")).toHaveText("Statements");
  await page.locator("#nav").getByRole("button", { name: /Tax/ }).first().click();
  await page.locator("#nav").getByRole("button", { name: "Tax Summary" }).click();
  await expect(page.locator("#viewTitle")).toHaveText("Tax Summary");
});

test("synthetic workbook imports and queued changes update it", async ({ page }) => {
  await page.goto("/?goldenTest=1");
  await page.waitForFunction(() => Boolean(window.__pechakTestApi));
  await page.locator("#file").setInputFiles(path.join(root, "public", "template.xlsx"));
  await expect(page.locator("#toast")).toContainText("Imported");
  await page.evaluate(data => window.__pechakTestApi.loadFixture(data), fixture);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Update workbook/ }).first().click();
  await expect(page.locator("#cm_confirm")).toBeVisible();
  await page.locator("#cm_confirm").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
});

test("portable backup export and restore follows the real DOM journey", async ({ page }) => {
  await openWithFixture(page);
  await page.getByRole("button", { name: "Open data safety" }).click();
  await page.locator('#v-data [data-cap="data"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export backup/ }).click();
  const backup = await downloadPromise;
  const backupPath = await backup.path();
  expect(backupPath).toBeTruthy();

  await page.getByRole("button", { name: "Add transaction" }).click();
  const overlay = page.locator("#addOverlay");
  await overlay.getByLabel("Amount").fill("123");
  await overlay.getByLabel("Category").selectOption("Food");
  await overlay.getByText("Optional details").click();
  await overlay.getByLabel("Comment").fill("Remove on restore");
  await overlay.getByRole("button", { name: "Save to queue" }).click();
  await page.getByRole("button", { name: "Open data safety" }).click();
  await page.locator('#v-data [data-cap="data"]').click();
  await page.locator("#cd_restore_file").setInputFiles(backupPath);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("Backup restored");
  await page.locator("#nav").getByRole("button", { name: /Transactions/ }).click();
  await expect(page.getByText("Remove on restore")).toHaveCount(0);
});
