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

async function main() {
  console.log("Loading browser");
  const browser = await dappeteer.launch(puppeteer, {
    metamaskVersion: process.env.METAMASK_VERSION || "v10.1.1",
    headless: false,
    args: ["--enable-automation", "--no-sandbox"],
    executablePath: process.env.PUPPETEER_EXEC_PATH,
  });
  console.log("Browser loaded");

  console.log("Waiting for metamask extension page");
  const metamaskPage = await timeout(
    new Promise((resolve, reject) => {
      browser.on("targetcreated", async (target) => {
        if (target.url().match("chrome-extension://[a-z]+/home.html")) {
          try {
            const page = await target.page();
            resolve(page);
          } catch (e) {
            reject(e);
          }
        }
      });
    }),
    30000
  );

  console.log("Reloading metamask extension page");
  await new Promise((res) => setTimeout(res, 5000));
  await metamaskPage.reload();
  await new Promise((res) => setTimeout(res, 5000));

  console.log("Loading metamask");
  const metamask = await timeout(
    dappeteer.setupMetamask(browser, {
      password: process.env.PASSWORD,
      seed: process.env.SEED,
    }),
    30000
  );
  console.log("Metamask loaded");

  const page = (await browser.pages())[0];

  const recorder = new PuppeteerScreenRecorder(page);

  await recorder.start("./recording.mp4");

  try {
    console.log("Loading Spartacus stake page");
    await page.goto("https://app.spartacus.finance/#/stake");

    await page.waitForSelector(".rebase-timer strong", {
      visible: true,
      timeout: 30000,
    });

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
      waitUntil: "domcontentloaded",
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
