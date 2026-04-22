import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolve } = require("node:path") as typeof import("node:path");

let server: ChildProcess | null = null;
let baseUrl = "";

async function startYap(): Promise<string> {
  return new Promise((resolveStart, reject) => {
    const bin = resolve(process.cwd(), "src/bin/yap.ts");
    const proc = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", bin],
      {
        env: { ...process.env, YAP_PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let resolved = false;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = /listening on (http:\/\/[^\s]+)/.exec(text);
      if (match && !resolved) {
        resolved = true;
        server = proc;
        resolveStart(match[1]!);
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("exit", (code) => {
      if (!resolved) reject(new Error(`yap exited before listening (code=${code})`));
    });
  });
}

test.beforeAll(async () => {
  baseUrl = await startYap();
});

test.afterAll(async () => {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    if (!server.killed) server.kill("SIGKILL");
  }
});

async function joinAs(page: Page, nick: string, channel: string, password?: string): Promise<void> {
  await page.goto(baseUrl);
  await page.fill('input[name="nick"]', nick);
  await page.fill('input[name="channel"]', channel);
  if (password) await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#chat")).toBeVisible();
  await expect(page.locator("#chat-channel")).toHaveText(channel);
}

async function say(page: Page, message: string): Promise<void> {
  await page.fill("#say-input", message);
  await page.press("#say-input", "Enter");
}

test("two humans can exchange messages in the same channel", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await joinAs(pageA, "alice", "#e2e");
  await joinAs(pageB, "bob", "#e2e");

  await say(pageA, "hello from alice");
  await expect(pageB.locator("#message-list")).toContainText("hello from alice", {
    timeout: 5000,
  });

  await say(pageB, "hi @alice");
  const aliceListItem = pageA.locator("#message-list li").filter({ hasText: "hi @alice" });
  await expect(aliceListItem).toHaveClass(/mentioned/, { timeout: 5000 });
  await expect(aliceListItem.locator(".mention")).toHaveText("@alice");

  await ctxA.close();
  await ctxB.close();
});

test("/me renders as an action", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await joinAs(page, "carol", "#actions");
  await say(page, "/me waves");
  const item = page.locator("#message-list li").last();
  await expect(item.locator(".msg.action")).toBeVisible();
  await expect(item.locator(".nick")).toContainText("* carol");
  await ctx.close();
});

test("refresh preserves the nick via cookie", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await joinAs(page, "dave", "#refresh");
  await page.reload();
  const nickField = page.locator('input[name="nick"]');
  await expect(nickField).toHaveValue("dave");
  await ctx.close();
});

test("password-gated channel rejects wrong password and accepts correct one", async ({
  browser,
}) => {
  const ctxOwner = await browser.newContext();
  const ownerPage = await ctxOwner.newPage();
  await joinAs(ownerPage, "owner", "#gated", "secret");

  const ctxWrong = await browser.newContext();
  const wrongPage = await ctxWrong.newPage();
  await wrongPage.goto(baseUrl);
  await wrongPage.fill('input[name="nick"]', "intruder");
  await wrongPage.fill('input[name="channel"]', "#gated");
  await wrongPage.fill('input[name="password"]', "nope");
  await wrongPage.click('button[type="submit"]');
  await expect(wrongPage.locator("#join-error")).toBeVisible();
  await expect(wrongPage.locator("#chat")).toBeHidden();

  const ctxRight = await browser.newContext();
  const rightPage = await ctxRight.newPage();
  await joinAs(rightPage, "friend", "#gated", "secret");
  await expect(rightPage.locator("#chat")).toBeVisible();

  await ctxOwner.close();
  await ctxWrong.close();
  await ctxRight.close();
});
