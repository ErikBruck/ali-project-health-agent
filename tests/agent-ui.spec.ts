import { expect, test } from "@playwright/test";

test("investigates project health through the dashboard chat", async ({ page }) => {
  await page.goto("/");

  const agent = page.getByRole("complementary", { name: "Ali project agent" });
  await expect(agent).toBeVisible();
  await expect(agent.getByText("Local demo agent", { exact: true })).toBeVisible();
  await expect(page.getByText("Live deterministic analysis", { exact: true })).toBeVisible();
  await expect(agent.locator("article.ali-message.assistant")).toHaveCount(1);

  await agent.getByPlaceholder(/Ask Ali about this project/).fill("Why is this project at risk?");
  const send = agent.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled();
  await send.click();

  await expect(agent.locator("article.ali-message.user").getByText("Why is this project at risk?", { exact: true })).toBeVisible();

  const response = agent.locator("article.ali-message.assistant").last();
  const traceButton = response.getByRole("button", { name: /tools used/i });
  await expect(traceButton).toBeVisible();
  await traceButton.click();
  await expect(response.locator("code").first()).toBeVisible();
  await expect(response.getByText(/Evidence/)).toBeVisible();

  await expect(agent.getByRole("button", { name: /Ali activity 1/ })).toBeVisible();
});

test("applies an approved proposal and restores it with undo", async ({ page }) => {
  await page.goto("/");

  const agent = page.getByRole("complementary", { name: "Ali project agent" });
  const capacity = page.locator("article.metric").filter({ hasText: "Capacity" });
  await expect(agent.locator("article.ali-message.assistant")).toHaveCount(1);
  await expect(capacity.locator("strong.big-value")).toHaveText("2");

  await agent.getByPlaceholder(/Ask Ali about this project/).fill("Reduce Mia's allocation to 95%");
  const send = agent.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled();
  await send.click();

  const proposal = agent.locator("section.ali-proposal").last();
  await expect(proposal.getByText("Approval required", { exact: true })).toBeVisible();
  await expect(proposal.getByText("Mia Chen", { exact: true })).toBeVisible();
  await expect(proposal.getByText("126", { exact: true })).toBeVisible();
  await expect(proposal.getByText("95", { exact: true })).toBeVisible();

  await proposal.getByRole("button", { name: "Approve plan" }).click();
  await expect(agent.getByText(/Plan applied and verified/)).toBeVisible();
  await expect(capacity.locator("strong.big-value")).toHaveText("1");

  const undo = agent.getByRole("button", { name: "Undo last Ali change" });
  await expect(undo).toBeEnabled();
  await undo.click();

  await expect(agent.getByText(/Last Ali change undone/)).toBeVisible();
  await expect(capacity.locator("strong.big-value")).toHaveText("2");
  await expect(proposal.getByText(/Undone/)).toBeVisible();
});

test("keeps the mobile agent full-screen and returns to the dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const agent = page.getByRole("complementary", { name: "Ali project agent" });
  await expect(agent).toBeVisible();
  await expect(agent).toHaveCSS("position", "fixed");

  const bounds = await agent.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(390);
  expect(bounds?.height).toBe(844);
  await expect(agent.getByPlaceholder(/Ask Ali about this project/)).toBeVisible();

  await agent.getByRole("button", { name: "Close Ali" }).click();
  await expect(agent).not.toBeInViewport();
  await expect(page.getByText("Live deterministic analysis", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Ali", exact: true })).toBeVisible();
});
