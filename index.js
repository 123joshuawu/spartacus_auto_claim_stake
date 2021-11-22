require("dotenv").config();

const fs = require("fs/promises");
const puppeteer = require("puppeteer");
const dappeteer = require("@chainsafe/dappeteer");
const { PuppeteerScreenRecorder } = require("puppeteer-screen-recorder");

const CLAIM_TIME_THRESHOLD_S = process.env.CLAIM_TIME_THRESHOLD_S || 20 * 60;

const parseDuration = (text) => {
  if (text === "") {
    return 0;
  }

  const parts = text.split(", ").map((part) => part.split(" "));

  let totalSeconds = 0;

  for (const [value, unit] of parts) {
    if (unit === "day" || unit === "days") {
      totalSeconds += parseInt(value) * 24 * 60 * 60;
    } else if (unit === "hr" || unit === "hrs") {
      totalSeconds += parseInt(value) * 60 * 60;
    } else if (unit === "min" || unit === "mins") {
      totalSeconds += parseInt(value) * 60;
    }
  }

  return totalSeconds;
};

const timeout = (prom, time) =>
  Promise.race([prom, new Promise((_r, rej) => setTimeout(rej, time))]);

let isMetamaskLoaded;

async function main() {
  let browser;
  let recorder;

  try {
    console.log("Loading browser");
    browser = await dappeteer.launch(puppeteer, {
      metamaskVersion: process.env.METAMASK_VERSION || "v10.1.1",
      headless: false,
      args: ["--enable-automation", "--no-sandbox"],
      executablePath: process.env.PUPPETEER_EXEC_PATH,
    });
    console.log("Browser loaded");

    isMetamaskLoaded = false;
    browser.on("targetcreated", async (target) => {
      if (isMetamaskLoaded) {
        return;
      }

      console.log("New browser target created");
      if (!target.url().match("chrome-extension://[a-z]+/home.html")) {
        return;
      }

      if (target.url().includes("welcome")) {
        console.log("Metmask extension already initialized");
        return;
      }

      console.log("Reloading metamask extension page");
      const page = await target.page();
      await page.reload({ waitUntil: "domcontentloaded" });
    });

    console.log("Loading metamask");
    const metamask = await timeout(
      dappeteer.setupMetamask(browser, {
        password: process.env.PASSWORD,
        seed: process.env.SEED,
      }),
      30000
    );
    isMetamaskLoaded = true;
    console.log("Metamask loaded");

    console.log("Get first page");
    const page = (await browser.pages())[0];

    await page.bringToFront();

    console.log("Start recording");
    recorder = new PuppeteerScreenRecorder(page);

    await recorder.start("./recording.mp4");

    console.log("Loading Spartacus stake page");
    await page.goto("https://app.spartacus.finance/#/stake", {
      waitUntil: ["domcontentloaded", "networkidle0"],
    });

    let tryCounter = 0;
    while (tryCounter < 3) {
      try {
        await page.waitForSelector(".rebase-timer strong", {
          visible: true,
          timeout: 30000,
        });

        break;
      } catch (err) {
        tryCounter += 1;

        await page.reload({
          waitUntil: ["domcontentloaded", "networkidle0"],
        });
      }
    }

    const rebaseTimerText = await page.evaluate(() => {
      const element = document.getElementsByClassName("rebase-timer").item(0);

      return element.getElementsByTagName("strong").item(0).innerText;
    });

    console.log("Timer text: ", rebaseTimerText);

    const totalSeconds = parseDuration(rebaseTimerText);

    if (totalSeconds > CLAIM_TIME_THRESHOLD_S) {
      console.log("SKIPPING");
      return { status: "skipped" };
    }

    console.log("Adding Fantom network");
    await metamask.addNetwork({
      networkName: "Fantom Opera",
      rpc: "https://rpc.ftm.tools/",
      chainId: 250,
    });

    console.log("Connecting wallet");
    await page.bringToFront();

    await page.click("#wallet-menu");

    await page.waitForSelector(".web3modal-provider-description");

    await page.click(".web3modal-provider-container");

    console.log("Approving metamask wallet connection");
    await metamask.approve();

    await page.bringToFront();

    console.log("Loading bonds page");
    await page.goto("https://app.spartacus.finance/#/bonds", {
      waitUntil: ["domcontentloaded", "networkidle0"],
    });

    console.log("Waiting for claim all and stake button");
    await page.waitForSelector("#claim-all-and-stake-btn", {
      visible: true,
      timeout: 30000,
    });

    if ((await page.$("button#claim-all-and-stake-btn[disabled]")) !== null) {
      console.log("NOTHING TO CLAIM");
      return { status: "skipped" };
    }

    console.log("Claim and staking all bonds");
    await page.click("#claim-all-and-stake-btn");

    console.log("Confirming metamask transaction");
    await metamask.confirmTransaction();

    console.log("PROCESSED CLAIM AND STAKE");
    return { status: "succeeded" };
  } catch (err) {
    console.error(err);
    return { status: "failed" };
  } finally {
    if (recorder) {
      console.log("Stopping recording");
      await recorder.stop();
    }

    if (browser) {
      console.log("Closing browser");
      await browser.close();
    }
  }
}

(async () => {
  const status = await main();

  console.log("Writing status: " + status.status);
  await fs.writeFile("status.json", JSON.stringify(status));
})();
