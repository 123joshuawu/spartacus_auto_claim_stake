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

async function main() {
  const browser = await dappeteer.launch(puppeteer, {
    metamaskVersion: process.env.METAMASK_VERSION || "latest",
    headless: true,
  });
  console.log("done brwoser");
  const metamask = await dappeteer.setupMetamask(browser, {
    password: process.env.PASSWORD,
    seed: process.env.SEED,
  });
  console.log("done metamas");
  await metamask.switchNetwork(process.env.NETWORK || "Fantom Opera");
  console.log("switch cnetw");
  const page = await browser.newPage();

  const recorder = new PuppeteerScreenRecorder(page);

  await recorder.start("./recording.mp4");

  try {
    await page.goto("https://app.spartacus.finance/#/stake", {
      waitUntil: "domcontentloaded",
    });

    await page.waitForSelector(".rebase-timer strong", {
      visible: true,
      timeout: 30000,
    });

    const rebaseText = await page.evaluate(() => {
      const element = document.getElementsByClassName("rebase-timer").item(0);

      return element.getElementsByTagName("strong").item(0).innerText;
    });

    console.log(rebaseText);

    const totalSeconds = parseDuration(rebaseText);

    console.log(totalSeconds);

    if (totalSeconds < 60 * 15) {
      console.log(" do the thang");

      await page.goTo("https://app.spartacus.finance/#/bonds", {
        waitUntil: "domcontentloaded",
      });

      await page.waitForSelector("#claim-all-and-stake-btn", {
        visible: true,
        timeout: 30000,
      });

      await page.click("#claim-all-and-stake-btn");

      await metamask.confirmTransaction();
    }
  } catch (err) {
    console.error(err);
  } finally {
    await recorder.stop();
    await browser.close();
  }
}

main();
