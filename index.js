const puppeteer = require("puppeteer-core");
const cheerio = require("cheerio");
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const express = require("express");

puppeteerExtra.use(StealthPlugin());
const app = express();

app.get("/wacc", async (req, res) => {
  let symbol = req.query.symbol || "BKK:AP";
  let baseTicker = symbol;
  if (symbol.endsWith(".BK")) {
    baseTicker = symbol.slice(0, -3); // ตัด ".BK" ออกจากท้าย
    symbol = `BKK:${baseTicker.toUpperCase()}`; // นำหน้าด้วย "BKK:" และแปลงเป็นตัวพิมพ์ใหญ่
  }
  try {
    const browser = await puppeteerExtra.connect({
      browserWSEndpoint:
        "wss://chrome.browserless.io?token=2SIrQeb8tsPhcRzcc70fbc504f332419789c7bd4a8cbd8079",
    });

    const page = await browser.newPage();
    await page.goto(`https://www.gurufocus.com/term/wacc/${symbol}`, {
      waitUntil: "networkidle2",
    });

    const html = await page.content();
    const $ = cheerio.load(html);

    const getSafeText = (selector) => $(selector).first().text()?.trim() ?? "";

    const wacc = (() => {
      const match = getSafeText("#target_def_description p").match(
        /cost of capital (is|was)?\s*([\d.]+)%+/i,
      );
      return match ? Number(match[2]) : null;
    })();

    const roic = (() => {
      const match = getSafeText("#target_def_description p").match(
        /ROIC.*?([\d.]+)%+/i,
      );
      return match ? Number(match[1]) : null;
    })();

    const calcPs = $("#target_def_calculation p.term_cal");
    const p0 = calcPs.eq(0).text();
    const p1 = calcPs.eq(1).text();
    const p2 = calcPs.eq(2).text();
    const p3 = calcPs.eq(3).text();

    const extractFloatAfterEqual = (text) => {
      const match = text.match(/=\s*([\d,]+\.?\d*)%?/);
      return match ? parseFloat(match[1].replace(/,/g, "")) : null;
    };

    const extractFloatFromText = (text, label) => {
      const regex = new RegExp(`${label}.*?([\\d,.]+)`, "i");
      const match = text.match(regex);
      return match ? Number(match[1].replace(/,/g, "")) : null;
    };

    const extractLastFloat = (text) => {
      const matches = text.match(/(\d+[,.]?\d*)(?=%?)(?!.*\d)/);
      return matches ? Number(matches[1].replace(/,/g, "")) : null;
    };

    const extractNumbersAfterCostOfEquity = (text) => {
      const match = text.match(
        /Cost of Equity\s*=\s*([\d.]+)\s*%\s*\+\s*([\d.]+)\s*\*\s*([\d.]+)\s*%\s*=\s*([\d.]+)%/,
      );
      return match ? match.slice(1).map((n) => Number(n)) : null;
    };

    const extractNumbersFromCostOfDebtLine = (text) => {
      const lines = text.split("\n").map((l) => l.trim());
      const line = lines.find((l) => l.startsWith("Cost of Debt ="));
      const match = line?.match(/=\s*([\d.]+)\s*\/\s*([\d.]+)\s*=\s*([\d.]+)%/);
      return match ? match.slice(1).map((n) => Number(n)) : null;
    };

    // Values from Cost of Equity
    const coeParts = extractNumbersAfterCostOfEquity(p1.split("c)")[1] ?? "");
    const [riskFreeRate, beta, marketPremium, costOfEquity] = coeParts ?? [
      null,
      null,
      null,
      null,
    ];

    // Values from Cost of Debt
    const codParts = extractNumbersFromCostOfDebtLine(p2);
    const [interestExpense, totalDebt, costOfDebt] = codParts ?? [
      null,
      null,
      null,
    ];

    const Result = {
      symbol: baseTicker,

      marketCapMil: extractFloatFromText(p0, "market capitalization.*?is") ?? 0,
      bookValueDebtMil:
        extractFloatFromText(p0, "Book Value of Debt.*?is") ?? 0,
      weightEquity: extractLastFloat(p0.split("a)")[1] ?? "") ?? 0,
      weightDebt: extractLastFloat(p0.split("b)")[1] ?? "") ?? 0,
      taxRate: extractFloatAfterEqual(p3) ?? 0,

      // equity
      costOfEquity: costOfEquity ? costOfEquity : 0,
      riskFreeRate: riskFreeRate ? riskFreeRate : 0,
      beta: beta ? beta : 0,
      marketPremium: marketPremium ? marketPremium : 0,

      // debt
      costOfDebt: costOfDebt ? costOfDebt : 0,
      interestExpense: interestExpense ? interestExpense : 0,
      totalDebt: totalDebt ? totalDebt : 0,

      wacc: wacc ? wacc : 0,
      roic: roic ? roic : 0,
    };

    await browser.close();
    res.json(Result);
  } catch (error) {
    res.status(500).json({ error: "Scrape failed", detail: error.message });
  }
});

app.get("/val", async (req, res) => {
  const symbol = req.query.symbol || "AP.BK";
  let baseTicker = symbol;
  if (symbol.endsWith(".BK")) {
    baseTicker = symbol.slice(0, -3); // ตัด ".BK" ออกจากท้าย
  }
  try {
    const browser = await puppeteerExtra.connect({
      browserWSEndpoint:
        "wss://chrome.browserless.io?token=2SIrQeb8tsPhcRzcc70fbc504f332419789c7bd4a8cbd8079",
    });

    const url = `https://valueinvesting.io/${symbol}/valuation/intrinsic-value`;
    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: "networkidle2",
    });

    const html = await page.content();
    const $ = cheerio.load(html);

    const result = {
      symbol: baseTicker,
      marketRiskPremium: 0,
      costOfEquity: 0,
      costOfDebt: 0,
      wacc: 0,
      valuation: [],
    };

    const allowedMethods = [
      "DCF (Growth 5y)",
      "DCF (Growth Exit 5Y)",

      "DCF (Growth 10y)",
      "DCF (Growth Exit 10Y)",

      "DCF (EBITDA 5y)",
      "DCF (EBITDA Exit 5Y)",

      "DCF (EBITDA 10y)",
      "DCF (EBITDA Exit 10Y)",

      "Fair Value",
      "Peter Lynch Fair Value",

      "P/E",
      "P/E Multiples",

      "EV/EBITDA",
      "EV/EBITDA Multiples",

      "EPV",
      "Earnings Power Value",

      "DDM - Stable",
      "Dividend Discount Model - Stable",

      "DDM - Multi",
      "Dividend Discount Model - Multi",
    ];

    $("table.each_summary tr").each((_, tr) => {
      const td = $(tr).find("td");

      if (td.length === 4) {
        const method = td.eq(0).text().trim();
        console.log("method 4 : ", method);

        if (!allowedMethods.includes(method)) return;

        const [minStr, maxStr] = td
          .eq(1)
          .text()
          .trim()
          .split("-")
          .map((v) => v.trim());
        const selected = parseFloat(td.eq(2).text().trim());
        const upsideText = td.eq(3).text().trim().replace("%", "");
        const valueMin = parseFloat(minStr);
        const valueMax = parseFloat(maxStr);
        const upside = parseFloat(upsideText);

        result.valuation.push({ method, valueMin, valueMax, selected, upside });
      }
    });

    $("table.market_table.overview_table tr").each((_, tr) => {
      const label = $(tr).find("td").eq(0).text().trim();
      const valueText = $(tr).find("td").eq(1).text().trim().replace("%", "");
      const value = parseFloat(valueText);

      if (label.includes("Market risk premium"))
        result.marketRiskPremium = value;
      else if (label.includes("Cost of Equity")) result.costOfEquity = value;
      else if (label.includes("Cost of Debt")) result.costOfDebt = value;
      else if (label.includes("WACC")) result.wacc = value;
    });

    await browser.close();

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Scrape failed", detail: error.message });
  }
});

app.get("/", (req, res) => {
  res.send("Puppeteer WACC API working. Try /wacc?symbol=BKK:AP");
});

app.listen(3000, () => console.log("✅ API live on port 3000"));
