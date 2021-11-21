require("dotenv").config();

const puppeteer = require("puppeteer");
const dappeteer = require("@chainsafe/dappeteer");
const { PuppeteerScreenRecorder } = require("puppeteer-screen-recorder");

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

const retry = async (prom, retries) => {
  let counter = 0;

  while (counter < retries) {
    try {
      await prom;

      return;
    } catch (err) {
      counter += 1;
    }
  }

  throw new Error("Max retries reached");
};

async function main() {
  console.log("Loading browser");
  const browser = await dappeteer.launch(puppeteer, {
    metamaskVersion: process.env.METAMASK_VERSION || "v10.1.1",
    headless: false,
    args: ["--enable-automation", "--no-sandbox"],
    executablePath: process.env.PUPPETEER_EXEC_PATH,
  });
  console.log("Browser loaded");

  browser.on("targetcreated", async (target) => {
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
  const metamask = timeout(
    dappeteer.setupMetamask(browser, {
      password: process.env.PASSWORD,
      seed: process.env.SEED,
    }),
    30000
  );
  console.log("Metamask loaded");

  console.log("Get first page");
  const page = (await browser.pages())[0];

  await page.bringToFront();

  console.log("Start recording");
  const recorder = new PuppeteerScreenRecorder(page);

  await recorder.start("./recording.mp4");

  try {
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

        await page.reload({ waitUntil: ["domcontentloaded", "networkidle0"] });
      }
    }
    const rebaseTimerText = await page.evaluate(() => {
      const element = document.getElementsByClassName("rebase-timer").item(0);

      return element.getElementsByTagName("strong").item(0).innerText;
    });

    console.log("Timer text: ", rebaseTimerText);

    const totalSeconds = parseDuration(rebaseTimerText);

    // if (totalSeconds > 60 * 15) {
    //   console.log("SKIPPING");
    //   return;
    // }

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

    console.log("Claim and staking all bonds");
    await page.click("#claim-all-and-stake-btn");

    console.log("Confirming metamask transaction");
    await metamask.confirmTransaction();

    console.log("PROCESSED CLAIM AND STAKE");
  } catch (err) {
    console.error(err);
  } finally {
    console.log("Cleaning up");
    await recorder.stop();
    await browser.close();
  }
}

main();
