import { demoLinks, expect, test } from "./fixtures";

test("customer reviews persist, update the rating and can be filtered and removed", async ({ page, request }) => {
  const links = await demoLinks(request);
  const email = `review.${Date.now()}@example.com`;
  const password = "a long review test password";
  const sent = await request.post(`/api${links.wedding_share}/register`, {
    data: { name: "Review Customer", email, password, consent: true },
  });
  expect(sent.status()).toBe(202);
  const { demo_code: code, signup_id } = await sent.json();
  const verified = await request.post("/api/guest/verify", { data: { email, code, signup_id } });
  expect(verified.status()).toBe(201);

  await page.goto("/restaurants/tagus-terrace#reviews");
  await page.getByRole("link", { name: "Log in to review" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/restaurants\/tagus-terrace#reviews$/);
  const count = page.locator(".reviews-head .review-count");
  const initial = Number((await count.innerText()).match(/\d+/)?.[0] ?? 0);
  const comment = `Review persistence check ${email}`;
  const published = page.locator(".reviews-list").getByText(comment, { exact: true });

  await page.getByRole("button", { name: "Write a review" }).click();
  await page.getByLabel("Your rating", { exact: true }).selectOption("10");
  await page.getByLabel("Comment (optional)").fill(comment);
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(published).toBeVisible();
  await expect(count).toHaveText(`From ${initial + 1} ${initial === 0 ? "review" : "reviews"}`);

  await page.reload();
  await expect(published).toBeVisible();
  await page.getByRole("button", { name: "Edit your review" }).click();
  await expect(page.getByLabel("Your rating", { exact: true })).toHaveValue("10");
  await page.getByLabel("Your rating", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Rating", { exact: true }).selectOption("0");
  await expect(published).toBeVisible();
  await page.getByLabel("Rating", { exact: true }).selectOption("10");
  await expect(published).toHaveCount(0);

  await page.getByRole("button", { name: "Edit your review" }).click();
  await page.getByRole("button", { name: "Delete review" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Rating", { exact: true }).selectOption("");
  await expect(published).toHaveCount(0);
  await expect(count).toHaveText(initial === 0 ? "No reviews yet" : `From ${initial} ${initial === 1 ? "review" : "reviews"}`);
  await expect(page.getByRole("button", { name: "Write a review" })).toBeVisible();
});
