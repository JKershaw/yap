import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolve } = require("node:path") as typeof import("node:path");

let server: ChildProcess | null = null;
let baseUrl = "";

const SHOT_DIR = process.env.SHOT_DIR ?? "test/e2e/screenshots-before";

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
}

async function say(page: Page, message: string): Promise<void> {
  await page.fill("#say-input", message);
  await page.press("#say-input", "Enter");
}

const DARK = { colorScheme: "dark" as const };

test("screenshot: landing page (desktop)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...DARK });
  const page = await ctx.newPage();
  await page.goto(baseUrl);
  await expect(page.locator("#landing")).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/01-landing-desktop.png`, fullPage: true });
  await ctx.close();
});

test("screenshot: landing page (mobile)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...DARK });
  const page = await ctx.newPage();
  await page.goto(baseUrl);
  await expect(page.locator("#landing")).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/02-landing-mobile.png`, fullPage: true });
  await ctx.close();
});

test("screenshot: landing with join error", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...DARK });
  const page = await ctx.newPage();
  // First create a password-gated channel
  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await joinAs(ownerPage, "owner", "#gated-shot", "rightpw");
  await owner.close();

  await page.goto(baseUrl);
  await page.fill('input[name="nick"]', "intruder");
  await page.fill('input[name="channel"]', "#gated-shot");
  await page.fill('input[name="password"]', "wrongpw");
  await page.click('button[type="submit"]');
  await expect(page.locator("#join-error")).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/03-landing-error.png`, fullPage: true });
  await ctx.close();
});

test("screenshot: empty chat room just joined", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...DARK });
  const page = await ctx.newPage();
  await joinAs(page, "alice", "#shots");
  await page.screenshot({ path: `${SHOT_DIR}/04-chat-empty.png`, fullPage: true });
  await ctx.close();
});

test("screenshot: chat with messages, mentions, action", async ({ browser }) => {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...DARK });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...DARK });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await joinAs(pageA, "alice", "#busy");
  await joinAs(pageB, "bob", "#busy");

  await say(pageA, "hello everyone, just joined");
  await expect(pageB.locator("#message-list")).toContainText("hello everyone", { timeout: 5000 });
  await say(pageB, "welcome @alice");
  await expect(pageA.locator("#message-list")).toContainText("welcome @alice", { timeout: 5000 });
  await say(pageA, "/me smiles and waves");
  await expect(pageB.locator("#message-list .msg.action")).toBeVisible({ timeout: 5000 });
  await say(pageB, "what's the plan for today?");
  await say(pageA, "I was thinking we could coordinate with @claude on the docs");
  await say(pageB, "sounds good! long messages also need to wrap nicely across multiple lines when someone decides to write a novel in a chat room that is meant for short exchanges only");
  await expect(pageA.locator("#message-list")).toContainText("sounds good", { timeout: 5000 });

  // Take screenshot from alice's view (with the mention highlighted)
  await pageA.screenshot({ path: `${SHOT_DIR}/05-chat-active-alice.png`, fullPage: true });
  // And from bob's view
  await pageB.screenshot({ path: `${SHOT_DIR}/06-chat-active-bob.png`, fullPage: true });

  await ctxA.close();
  await ctxB.close();
});

test("screenshot: chat mobile view", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...DARK });
  const page = await ctx.newPage();
  await joinAs(page, "mobileuser", "#mobile-shot");
  await say(page, "hello from my phone");
  await expect(page.locator("#message-list")).toContainText("hello from my phone", { timeout: 5000 });
  await say(page, "/me checks messages");
  await expect(page.locator("#message-list .msg.action")).toBeVisible({ timeout: 5000 });
  await say(page, "@bob are you around?");
  await expect(page.locator("#message-list")).toContainText("are you around", { timeout: 10000 });
  await page.screenshot({ path: `${SHOT_DIR}/07-chat-mobile.png`, fullPage: true });
  await ctx.close();
});

test("screenshot: chat with many users and overflow", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...DARK });
  const page = await ctx.newPage();
  await joinAs(page, "alice", "#crowd");

  // Add several other users via API
  const users = ["bob", "carol", "dave", "eve", "frank", "grace", "heidi", "ivan"];
  for (const nick of users) {
    await page.evaluate(async (n) => {
      await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nick: n, channel: "#crowd" }),
      });
      await fetch("/api/say", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nick: n, channel: "#crowd", message: `hi from ${n}` }),
      });
    }, nick);
  }
  // Give it time to poll
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT_DIR}/08-chat-crowd.png`, fullPage: true });
  await ctx.close();
});

test("screenshot: mobile who-drawer (closed and open)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...DARK });
  const page = await ctx.newPage();
  await joinAs(page, "alice", "#who-shot");

  // Populate the member list via API so the drawer has names to show.
  for (const nick of ["bob", "carol", "dave"]) {
    await page.evaluate(async (n) => {
      await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nick: n, channel: "#who-shot" }),
      });
      await fetch("/api/say", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nick: n, channel: "#who-shot", message: `hi from ${n}` }),
      });
    }, nick);
  }
  // who-list refreshes every 10s in the UI, so we need to allow up to one
  // full interval after injecting the other members via API.
  await expect(page.locator("#who-count")).toHaveText("4", { timeout: 15000 });
  // Viewport-only (not fullPage): the drawer is position:absolute off-screen,
  // which would otherwise inflate the captured width past the phone viewport.
  await page.screenshot({ path: `${SHOT_DIR}/10-chat-mobile-who-closed.png` });

  await page.click("#who-toggle");
  // Wait for the slide-in transition to finish before capturing.
  await page.waitForFunction(() => {
    const p = document.getElementById("who-panel");
    if (!p || !p.classList.contains("open")) return false;
    const m = getComputedStyle(p).transform;
    return m === "none" || m === "matrix(1, 0, 0, 1, 0, 0)";
  });
  await page.screenshot({ path: `${SHOT_DIR}/11-chat-mobile-who-open.png` });
  await ctx.close();
});

test("screenshot: say input focused", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...DARK });
  const page = await ctx.newPage();
  await joinAs(page, "alice", "#focus-shot");
  await page.fill("#say-input", "typing a message that hasn't been sent yet...");
  await page.screenshot({ path: `${SHOT_DIR}/09-chat-typing.png`, fullPage: true });
  await ctx.close();
});
